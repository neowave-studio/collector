import {decodeEventLog, type Hex, type Log} from 'viem';
import {allChains, type ChainContext} from '../chains.js';
import {collectibleAbi, gachaAbi, marketplaceAbi, reserveVaultAbi, vaultAbi} from '../lib/abi.js';
import {query, transaction, withAdvisoryLock} from '../db/index.js';
import {logger, alert} from '../lib/logger.js';
import * as idem from '../lib/idempotency.js';

/**
 * Event indexer (spec §8.1, §8.4).
 *
 * The chain is authoritative; this rebuilds the DB cache from its events. Two consequences shape the
 * implementation:
 *
 *  - it only reads up to `head - confirmations`, using per-chain depths set ABOVE known reorg depths
 *    (Polygon and BNB are the reason that number is not a constant);
 *  - on detecting that its stored block hash no longer matches the canonical chain, it rewinds,
 *    deletes what it wrote past the fork point, reopens affected idempotency keys, and replays.
 *
 * Every money fact here is therefore reconstructable from events alone, which is what lets the
 * reconciler treat a chain↔DB divergence as a defect rather than as normal drift.
 */

/**
 * Default `eth_getLogs` span. Overridable per chain via `logBatchSize` in chains.json.
 *
 * Providers disagree sharply about what they will serve. Base Sepolia is happy with 2,000 blocks;
 * some free endpoints cap at 50; BSC's public nodes refuse `eth_getLogs` over historical ranges at
 * any span at all. A single constant cannot satisfy all of them, and getting it wrong does not fail
 * loudly — the indexer simply never advances, so every page renders empty while the service looks
 * healthy.
 */
const DEFAULT_BLOCK_BATCH = 2_000n;

function blockBatchFor(chain: ChainContext): bigint {
  const configured = (chain as {logBatchSize?: number}).logBatchSize;
  return configured && configured > 0 ? BigInt(configured) : DEFAULT_BLOCK_BATCH;
}

export async function indexChain(chain: ChainContext): Promise<void> {
  await withAdvisoryLock(`indexer:${chain.chainId}`, async () => {
    const head = await chain.client.getBlockNumber();
    const safeHead = head - BigInt(chain.confirmations);
    if (safeHead <= 0n) return;

    const rows = await query<{last_indexed_block: string}>(
      'SELECT last_indexed_block FROM chains WHERE chain_id = $1',
      [chain.chainId],
    );
    let from = BigInt(rows[0]?.last_indexed_block ?? '0') + 1n;
    const batch = blockBatchFor(chain);
    if (from > safeHead) return;

    while (from <= safeHead) {
      const to = from + batch - 1n > safeHead ? safeHead : from + batch - 1n;
      await indexRange(chain, from, to);
      await query('UPDATE chains SET last_indexed_block = $2, updated_at = now() WHERE chain_id = $1', [
        chain.chainId,
        to.toString(),
      ]);
      from = to + 1n;
    }
  });
}

async function indexRange(chain: ChainContext, fromBlock: bigint, toBlock: bigint): Promise<void> {
  const {gachaMachine, reserveVault, vault, collectibleNFT, marketplace} = chain.deployment;

  /**
   * One `eth_getLogs` for every contract, not five.
   *
   * `eth_getLogs` accepts an array of addresses, and the node does the filtering either way. Asking
   * five times multiplied our request rate by five for no extra information — enough to trip the free
   * tier of every provider tried here within seconds, on a five-second poll. The result is partitioned
   * by `log.address` below, so each handler still sees only its own contract's events and two
   * contracts sharing an event signature can never be confused for one another.
   */
  const addresses = [vault, collectibleNFT, marketplace, ...(chain.gachaEnabled ? [gachaMachine, reserveVault] : [])];

  const logs = await chain.client.getLogs({address: addresses, fromBlock, toBlock});

  const byAddress = new Map<string, Log[]>();
  for (const log of logs) {
    const key = log.address.toLowerCase();
    const bucket = byAddress.get(key);
    if (bucket) bucket.push(log);
    else byAddress.set(key, [log]);
  }
  const forContract = (address: string): Log[] => byAddress.get(address.toLowerCase()) ?? [];

  await handleMarketplaceLogs(chain, forContract(marketplace));
  await handleGachaLogs(chain, forContract(gachaMachine));
  await handleReserveLogs(chain, forContract(reserveVault));
  await handleVaultLogs(chain, forContract(vault));
  await handleNftLogs(chain, forContract(collectibleNFT));

  logger.debug(
    {chainId: chain.chainId, fromBlock: fromBlock.toString(), toBlock: toBlock.toString()},
    'indexed block range',
  );
}

async function handleGachaLogs(chain: ChainContext, logs: Log[]): Promise<void> {
  for (const raw of logs) {
    const decoded = decode(chain, raw, gachaAbi);
    if (!decoded) continue;
    const {eventName, args, blockNumber, transactionHash} = decoded;

    switch (eventName) {
      case 'RipRequested': {
        const first = args.firstDrawId as bigint;
        const numRips = args.numRips as bigint;
        const packId = args.packId as Hex;
        const version = args.poolVersion as bigint;

        for (let i = 0n; i < numRips; i++) {
          const drawId = first + i;
          const draw = await chain.client.readContract({
            address: chain.deployment.gachaMachine,
            abi: gachaAbi,
            functionName: 'getDraw',
            args: [drawId],
          });
          await query(
            `INSERT INTO draws (chain_id, draw_id, user_address, pack_id, pool_version, vrf_request_id,
                                reserved_amount, escrow, status, requested_block)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'requested',$9)
             ON CONFLICT (chain_id, draw_id) DO UPDATE SET vrf_request_id = EXCLUDED.vrf_request_id`,
            [
              chain.chainId,
              drawId.toString(),
              (args.user as string).toLowerCase(),
              packId,
              version.toString(),
              (args.vrfRequestId as bigint).toString(),
              draw.reservedAmount.toString(),
              draw.escrow.toString(),
              blockNumber.toString(),
            ],
          );
        }
        break;
      }

      case 'RipRevealed':
        await query(
          `UPDATE draws SET winning_weight = $3, status = 'revealed', revealed_at = now()
            WHERE chain_id = $1 AND draw_id = $2 AND status = 'requested'`,
          [chain.chainId, (args.drawId as bigint).toString(), (args.winningWeight as bigint).toString()],
        );
        break;

      case 'RevealFailed':
        // The draw stays unrevealed and therefore refundable. Surfaced because it should never
        // realistically happen (spec §5.3.2) — if it does, something is wrong with the VRF wiring.
        await alert('vrf_reveal_failed', {
          chainId: chain.chainId,
          drawId: (args.drawId as bigint).toString(),
          vrfRequestId: (args.vrfRequestId as bigint).toString(),
        });
        break;

      case 'RipSettled':
        await recordSettlement(chain, {
          drawId: args.drawId as bigint,
          kind: (args.viaTimeout as boolean) ? 'timeout' : 'deliver',
          status: 'delivered',
          tokenId: args.tokenId as bigint,
          txHash: transactionHash,
          block: blockNumber,
        });
        break;

      case 'BuybackSettled':
        await recordSettlement(chain, {
          drawId: args.drawId as bigint,
          kind: 'buyback',
          status: 'bought_back',
          payout: args.payout as bigint,
          tokenId: args.tokenId as bigint,
          txHash: transactionHash,
          block: blockNumber,
        });
        break;

      case 'DrawUnavailable':
        await recordSettlement(chain, {
          drawId: args.drawId as bigint,
          kind: 'compensate',
          status: 'compensated',
          payout: args.payout as bigint,
          tokenId: args.tokenId as bigint,
          txHash: transactionHash,
          block: blockNumber,
        });
        // A user who wanted a card got money instead. Rare by design (the staleness breaker keeps it
        // a tail event) and a signal that ops must re-version the pool.
        await alert('draw_compensated_card_unavailable', {
          chainId: chain.chainId,
          drawId: (args.drawId as bigint).toString(),
          tokenId: (args.tokenId as bigint).toString(),
        });
        break;

      case 'RipRefunded':
        await recordSettlement(chain, {
          drawId: args.drawId as bigint,
          kind: 'refund',
          status: 'refunded',
          payout: args.amount as bigint,
          txHash: transactionHash,
          block: blockNumber,
        });
        break;

      case 'PoolCommitted':
        await alert('pool_committed', {
          chainId: chain.chainId,
          packId: args.packId as Hex,
          version: (args.version as bigint).toString(),
          root: args.root as Hex,
          poolCID: args.poolCID as Hex,
        });
        break;

      case 'ActiveVersionScheduled':
        await query(
          `UPDATE packs SET active_pool_version = $3, active_from_block = $4
            WHERE chain_id = $1 AND pack_id = $2`,
          [
            chain.chainId,
            args.packId as Hex,
            (args.version as bigint).toString(),
            (args.activeFromBlock as bigint).toString(),
          ],
        );
        await alert('active_pool_version_scheduled', {
          chainId: chain.chainId,
          packId: args.packId as Hex,
          version: (args.version as bigint).toString(),
          activeFromBlock: (args.activeFromBlock as bigint).toString(),
        });
        break;

      default:
        break;
    }
  }
}

async function recordSettlement(
  chain: ChainContext,
  s: {
    drawId: bigint;
    kind: string;
    status: string;
    tokenId?: bigint;
    payout?: bigint;
    txHash: Hex;
    block: bigint;
  },
): Promise<void> {
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO settlements (chain_id, draw_id, kind, token_id, payout, tx_hash, block)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (chain_id, draw_id) DO NOTHING`,
      [
        chain.chainId,
        s.drawId.toString(),
        s.kind,
        s.tokenId?.toString() ?? null,
        s.payout?.toString() ?? null,
        s.txHash,
        s.block.toString(),
      ],
    );
    await client.query('UPDATE draws SET status = $3 WHERE chain_id = $1 AND draw_id = $2', [
      chain.chainId,
      s.drawId.toString(),
      s.status,
    ]);
  });
}

/** A filled order is settled fact once the contract says so — close it in the index. */
async function handleMarketplaceLogs(chain: ChainContext, logs: Log[]): Promise<void> {
  for (const raw of logs) {
    const decoded = decode(chain, raw, marketplaceAbi);
    if (!decoded || decoded.eventName !== 'Filled') continue;
    const {args, blockNumber, transactionHash} = decoded;

    await query(
      `UPDATE listings
          SET status = 'filled', filled_tx = $3, filled_by = $4, filled_block = $5, updated_at = now()
        WHERE chain_id = $1 AND order_hash = $2 AND status = 'open'`,
      [
        chain.chainId,
        args.orderHash as Hex,
        transactionHash,
        (args.buyer as string).toLowerCase(),
        blockNumber.toString(),
      ],
    );

    await query(
      `UPDATE nfts SET owner = $3, synced_block = $4 WHERE chain_id = $1 AND token_id = $2`,
      [
        chain.chainId,
        (args.tokenId as bigint).toString(),
        (args.buyer as string).toLowerCase(),
        blockNumber.toString(),
      ],
    );
  }
}

async function handleReserveLogs(chain: ChainContext, logs: Log[]): Promise<void> {
  for (const raw of logs) {
    const decoded = decode(chain, raw, reserveVaultAbi);
    if (!decoded) continue;
    const {eventName, args, blockNumber} = decoded;
    const token = (args.token as string | undefined)?.toLowerCase();
    if (!token) continue;

    const bump = async (column: string, amount: bigint) =>
      query(
        `INSERT INTO reserve_ledger (chain_id, token, ${column}, synced_block)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (chain_id, token) DO UPDATE
           SET ${column} = reserve_ledger.${column} + EXCLUDED.${column},
               synced_block = EXCLUDED.synced_block, updated_at = now()`,
        [chain.chainId, token, amount.toString(), blockNumber.toString()],
      );

    switch (eventName) {
      case 'Funded':
        await bump('funded', args.amount as bigint);
        break;
      case 'Reserved':
      case 'Unreserved':
        // The event carries the authoritative running total, so mirror it rather than accumulating —
        // an accumulated value would drift permanently after any missed log.
        await query(
          `INSERT INTO reserve_ledger (chain_id, token, reserved, synced_block)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (chain_id, token) DO UPDATE
             SET reserved = EXCLUDED.reserved, synced_block = EXCLUDED.synced_block, updated_at = now()`,
          [chain.chainId, token, (args.totalReserved as bigint).toString(), blockNumber.toString()],
        );
        break;
      case 'Paid': {
        await bump('paid', args.amount as bigint);

        // A payout also retires the rest of the draw's reservation — `releasedRemainder` on this same
        // event — but unlike Reserved/Unreserved it does not carry the resulting running total, so
        // there is nothing here to mirror. Leaving it out kept `reserved` pinned at the pre-payout
        // figure forever, which the reconciler then read as reserve divergence and, in production,
        // would answer by pausing buyback and new rips over an accounting artefact.
        //
        // Re-read the authoritative total rather than subtracting locally: subtraction re-introduces
        // exactly the drift the mirror-don't-accumulate rule above exists to prevent.
        // Pinned to the block being processed, not head: this row is the ledger's value *as of* this
        // event, and the reconciler compares against it at exactly that block.
        const totalReserved = await chain.client.readContract({
          address: chain.deployment.reserveVault,
          abi: reserveVaultAbi,
          functionName: 'reservedLiabilities',
          args: [token as `0x${string}`],
          blockNumber,
        });
        await query(
          `INSERT INTO reserve_ledger (chain_id, token, reserved, synced_block)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (chain_id, token) DO UPDATE
             SET reserved = EXCLUDED.reserved, synced_block = EXCLUDED.synced_block, updated_at = now()`,
          [chain.chainId, token, totalReserved.toString(), blockNumber.toString()],
        );
        break;
      }
      case 'SurplusWithdrawn':
        await alert('reserve_surplus_withdrawn', {
          chainId: chain.chainId,
          token,
          amount: (args.amount as bigint).toString(),
          to: args.to as string,
        });
        break;
      default:
        break;
    }
  }
}

async function handleVaultLogs(chain: ChainContext, logs: Log[]): Promise<void> {
  for (const raw of logs) {
    const decoded = decode(chain, raw, vaultAbi);
    if (!decoded) continue;
    const {eventName, args, blockNumber} = decoded;

    switch (eventName) {
      case 'Deposited':
        await query(
          `UPDATE nfts SET location = 'vault', pack_id = $3, owner = NULL, synced_block = $4
            WHERE chain_id = $1 AND token_id = $2`,
          [chain.chainId, (args.tokenId as bigint).toString(), args.packId as Hex, blockNumber.toString()],
        );
        break;
      case 'Released':
        await query(
          `UPDATE nfts SET location = 'user', owner = $3, pack_id = NULL, synced_block = $4
            WHERE chain_id = $1 AND token_id = $2`,
          [
            chain.chainId,
            (args.tokenId as bigint).toString(),
            (args.to as string).toLowerCase(),
            blockNumber.toString(),
          ],
        );
        break;
      case 'Swept':
        // The one slow, public admin exit from inventory (spec §7.1.3). Always alerted.
        await alert('inventory_swept', {
          chainId: chain.chainId,
          tokenId: (args.tokenId as bigint).toString(),
          to: args.to as string,
          by: args.by as string,
        });
        break;
      default:
        break;
    }
  }
}

async function handleNftLogs(chain: ChainContext, logs: Log[]): Promise<void> {
  for (const raw of logs) {
    const decoded = decode(chain, raw, collectibleAbi);
    if (!decoded) continue;
    const {eventName, args, blockNumber, transactionHash} = decoded;

    if (eventName === 'RedeemRequested') {
      // Shipment is driven ONLY by this event and is idempotent on tokenId (spec §5.1 FIX H7-backend).
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO shipments (chain_id, token_id, redeem_tx, recipient)
           VALUES ($1,$2,$3,$4) ON CONFLICT (chain_id, token_id) DO NOTHING`,
          [
            chain.chainId,
            (args.tokenId as bigint).toString(),
            transactionHash,
            (args.owner as string).toLowerCase(),
          ],
        );
        await client.query(
          `UPDATE nfts SET location = 'redeemed', synced_block = $3 WHERE chain_id = $1 AND token_id = $2`,
          [chain.chainId, (args.tokenId as bigint).toString(), blockNumber.toString()],
        );
      });
    }

    if (eventName === 'Transfer') {
      const to = (args.to as string).toLowerCase();
      if (to !== '0x0000000000000000000000000000000000000000') {
        await query(
          `UPDATE nfts SET owner = $3, synced_block = $4
            WHERE chain_id = $1 AND token_id = $2 AND location <> 'redeemed'`,
          [chain.chainId, (args.tokenId as bigint).toString(), to, blockNumber.toString()],
        );
      }
    }
  }
}

function decode(
  _chain: ChainContext,
  raw: Log,
  abi: readonly unknown[],
):
  | {eventName: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: Hex}
  | undefined {
  try {
    // `decodeEventLog` throws on any log that does not belong to this ABI, which is the normal case
    // when a batch query spans several contracts. A miss is not an error — it is a different event.
    const decoded = decodeEventLog({abi: abi as never, data: raw.data, topics: raw.topics});
    // A pending log has no block or tx hash yet. We only ever query confirmed ranges, so this is a
    // defensive guard rather than an expected branch.
    if (raw.blockNumber == null || raw.transactionHash == null) return undefined;
    return {
      eventName: String(decoded.eventName),
      args: (decoded.args ?? {}) as Record<string, unknown>,
      blockNumber: raw.blockNumber,
      transactionHash: raw.transactionHash,
    };
  } catch {
    return undefined;
  }
}

/**
 * Rewinds the cache past a fork point and lets the next pass replay it.
 * Called when the stored head no longer matches the canonical chain.
 */
export async function handleReorg(chain: ChainContext, forkBlock: bigint): Promise<void> {
  await alert('reorg_detected', {chainId: chain.chainId, forkBlock: forkBlock.toString()});

  await transaction(async (client) => {
    await client.query('DELETE FROM settlements WHERE chain_id = $1 AND block >= $2', [
      chain.chainId,
      forkBlock.toString(),
    ]);
    await client.query(
      `UPDATE draws SET status = 'requested'
        WHERE chain_id = $1 AND draw_id IN (
          SELECT draw_id FROM settlements WHERE chain_id = $1 AND block >= $2)`,
      [chain.chainId, forkBlock.toString()],
    );
    await client.query('UPDATE chains SET last_indexed_block = $2 WHERE chain_id = $1', [
      chain.chainId,
      (forkBlock - 1n).toString(),
    ]);
  });

  await idem.reopenReorgedKeys(chain.chainId, forkBlock);

  if (BigInt(chain.confirmations) < forkBlock) {
    // A reorg deeper than the depth we consider safe means our confirmation setting is wrong for this
    // chain — that is a configuration incident, not a routine event.
    await alert('reorg_exceeded_configured_depth', {
      chainId: chain.chainId,
      configuredConfirmations: chain.confirmations,
    });
  }
}

export async function indexAllChains(): Promise<void> {
  for (const chain of allChains()) {
    try {
      await indexChain(chain);
    } catch (err) {
      logger.error({err, chainId: chain.chainId}, 'indexer pass failed');
    }
  }
}
