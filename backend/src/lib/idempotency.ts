import {query, transaction} from '../db/index.js';
import {logger} from './logger.js';

/**
 * Durable, reorg-aware idempotency for money actions (spec §8.4, FIX C3/M7-backend).
 *
 * Two properties the spec makes non-negotiable, and why:
 *
 *  - **Durable, not Redis-only.** A Redis flush would make every previously-submitted rip look new,
 *    and the relayer would happily charge the user a second time. The record therefore lives in
 *    Postgres, in the same database as the rest of the money state.
 *
 *  - **Reorg-aware.** A key becomes `confirmed` only once its transaction is buried under the chain's
 *    configured `confirmations`. If a reorg drops it below that depth, {reopenReorgedKeys} puts it
 *    back to `in_flight` so it can be resubmitted — the alternative is a user who paid on a discarded
 *    fork and is told their rip already happened.
 */

export type IdempotencyState = 'in_flight' | 'submitted' | 'confirmed' | 'failed';

export interface IdempotencyRecord {
  key: string;
  chain_id: string;
  kind: string;
  state: IdempotencyState;
  tx_hash: string | null;
  observed_block: string | null;
  result: unknown;
}

export function drawKey(chainId: number, drawId: bigint, kind: string): string {
  return `${chainId}:${drawId}:${kind}`;
}

export function userActionKey(chainId: number, user: string, nonce: bigint, kind: string): string {
  return `${chainId}:${user.toLowerCase()}:${nonce}:${kind}`;
}

/**
 * Claims `key` for this caller. Returns `null` when another attempt already owns it, in which case
 * the caller must NOT perform the action — it either already happened or is in flight.
 */
export async function claim(key: string, chainId: number, kind: string): Promise<IdempotencyRecord | null> {
  return transaction(async (client) => {
    const existing = await client.query<IdempotencyRecord>(
      'SELECT * FROM idempotency_keys WHERE key = $1 FOR UPDATE',
      [key],
    );

    const row = existing.rows[0];
    if (row) {
      if (row.state === 'failed') {
        // A previous attempt reverted before it could be mined; the user was not charged, so retry.
        await client.query(
          `UPDATE idempotency_keys SET state = 'in_flight', tx_hash = NULL, observed_block = NULL,
             updated_at = now() WHERE key = $1`,
          [key],
        );
        return {...row, state: 'in_flight' as const, tx_hash: null, observed_block: null};
      }
      return null;
    }

    const inserted = await client.query<IdempotencyRecord>(
      `INSERT INTO idempotency_keys (key, chain_id, kind, state) VALUES ($1, $2, $3, 'in_flight')
       RETURNING *`,
      [key, chainId, kind],
    );
    return inserted.rows[0] ?? null;
  });
}

export async function markSubmitted(key: string, txHash: string): Promise<void> {
  await query(
    `UPDATE idempotency_keys SET state = 'submitted', tx_hash = $2, updated_at = now() WHERE key = $1`,
    [key, txHash],
  );
}

/** Only call once the transaction is buried under the chain's `confirmations`. */
export async function markConfirmed(key: string, block: bigint, result?: unknown): Promise<void> {
  await query(
    `UPDATE idempotency_keys SET state = 'confirmed', observed_block = $2, result = $3, updated_at = now()
     WHERE key = $1`,
    [key, block.toString(), result === undefined ? null : JSON.stringify(result)],
  );
}

export async function markFailed(key: string, reason: string): Promise<void> {
  await query(
    `UPDATE idempotency_keys SET state = 'failed', result = $2, updated_at = now() WHERE key = $1`,
    [key, JSON.stringify({reason: scrubForJsonb(reason)})],
  );
}

/**
 * Strips NUL bytes before a string reaches a `jsonb` column.
 *
 * Revert reasons are built from raw ABI-encoded return data, which is zero-padded, so they routinely
 * carry NUL bytes. Postgres accepts NUL in `text` but rejects it inside `jsonb` (SQLSTATE 22P05) —
 * and this is the failure path, so the write recording "the transaction failed" would itself throw,
 * turning a handled revert into an unhandled 500 and leaving the key stuck out of its terminal state
 * so retries were refused. The error text is for humans reading logs; padding bytes carry no meaning.
 */
export function scrubForJsonb(text: string): string {
  return text.replace(/\u0000/g, '');
}

export async function get(key: string): Promise<IdempotencyRecord | undefined> {
  const rows = await query<IdempotencyRecord>('SELECT * FROM idempotency_keys WHERE key = $1', [key]);
  return rows[0];
}

/**
 * Reopens keys whose transaction was reorged out from under them.
 * Called by the indexer whenever it detects the canonical chain no longer contains a tx it had seen.
 */
export async function reopenReorgedKeys(chainId: number, fromBlock: bigint): Promise<number> {
  const rows = await query<{key: string}>(
    `UPDATE idempotency_keys
        SET state = 'in_flight', tx_hash = NULL, observed_block = NULL, updated_at = now()
      WHERE chain_id = $1 AND observed_block >= $2 AND state IN ('submitted', 'confirmed')
      RETURNING key`,
    [chainId, fromBlock.toString()],
  );
  if (rows.length) {
    logger.warn({chainId, fromBlock: fromBlock.toString(), count: rows.length}, 'reopened idempotency keys after reorg');
  }
  return rows.length;
}
