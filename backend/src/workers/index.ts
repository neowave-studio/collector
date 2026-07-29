import {initChains, allChains, getChain} from '../chains.js';
import {config, assertComplianceModeIsSafe} from '../config.js';
import {logger, alert} from '../lib/logger.js';
import {indexAllChains} from '../services/indexer.js';
import {reconcileAllChains} from '../services/reconciler.js';
import {buildLeafProof} from '../services/proofs.js';
import {query} from '../db/index.js';
import * as relayer from '../services/relayer.js';
import {drawKey} from '../lib/idempotency.js';
import {gachaAbi} from '../lib/abi.js';
import {encodeFunctionData} from 'viem';
import {pathToFileURL} from 'node:url';
import {pool} from '../db/index.js';
import {initSigners} from '../services/signer.js';

/**
 * Background workers.
 *
 * Deviation from spec §8 worth naming: the spec lists BullMQ. This uses interval loops guarded by
 * Postgres advisory locks instead. The work here is all "reconcile against chain state", which is
 * idempotent and self-healing — a missed tick simply does more on the next one — so a durable queue
 * would add a second source of truth about what has been processed without adding a guarantee. Jobs
 * that genuinely need retry semantics (email, shipment dispatch) should use BullMQ when they land.
 */

let running = true;

async function loop(name: string, intervalMs: number, fn: () => Promise<void>): Promise<void> {
  while (running) {
    const startedAt = Date.now();
    try {
      await fn();
    } catch (err) {
      logger.error({err, worker: name}, 'worker pass failed');
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed > intervalMs * 3) {
      // A worker that cannot keep up means the indexer is falling behind the chain, which makes every
      // downstream figure (including proof of reserves) stale.
      await alert('worker_lagging', {worker: name, elapsedMs: elapsed, intervalMs});
    }
    await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - elapsed)));
  }
}

/**
 * Settles revealed draws on the user's behalf.
 *
 * Purely a convenience: `claimAfterTimeout` means every one of these draws is deliverable by anyone,
 * forever, without us. What this loop buys the user is not safety — it is not having to wait out the
 * timeout or pay their own gas.
 */
async function settleRevealedDraws(): Promise<void> {
  for (const chain of allChains()) {
    if (!chain.gachaEnabled) continue;

    const window = await chain.client.readContract({
      address: chain.deployment.gachaMachine,
      abi: gachaAbi,
      functionName: 'buybackWindow',
    });

    const due = await query<{draw_id: string; pack_id: string; pool_version: string; winning_weight: string}>(
      `SELECT draw_id, pack_id, pool_version, winning_weight
         FROM draws
        WHERE chain_id = $1 AND status = 'revealed'
          AND revealed_at < now() - ($2 || ' seconds')::interval
        ORDER BY revealed_at ASC LIMIT 25`,
      [chain.chainId, window.toString()],
    );

    for (const row of due) {
      const drawId = BigInt(row.draw_id);
      try {
        const proof = await buildLeafProof({
          chainId: chain.chainId,
          packId: row.pack_id as `0x${string}`,
          version: BigInt(row.pool_version),
          winningWeight: BigInt(row.winning_weight),
        });

        // If the drawn card has already gone to an earlier draw, the user is owed compensation rather
        // than a card. `claimUnavailable` pays from the reservation booked at rip time.
        const held = await chain.client.readContract({
          address: chain.deployment.vault,
          abi: [
            {
              type: 'function',
              name: 'isHeld',
              stateMutability: 'view',
              inputs: [{type: 'uint256'}],
              outputs: [{type: 'bool'}],
            },
          ] as const,
          functionName: 'isHeld',
          args: [proof.tokenId],
        });

        const fn = held ? 'settle' : 'claimUnavailable';
        await relayer.send({
          chainId: chain.chainId,
          role: 'relayer',
          to: chain.deployment.gachaMachine,
          data: encodeFunctionData({abi: gachaAbi, functionName: fn, args: [drawId, proof]}),
          idempotencyKey: drawKey(chain.chainId, drawId, fn),
          kind: fn,
        });
      } catch (err) {
        logger.error({err, drawId: row.draw_id}, 'auto-settle failed; the user can still self-settle');
      }
    }
  }
}

/** Pushes realised rip revenue to its committed destinations so it stops sitting in the machine. */
async function flushRevenue(): Promise<void> {
  for (const chain of allChains()) {
    if (!chain.gachaEnabled) continue;
    for (const token of Object.values(chain.payTokens)) {
      try {
        await relayer.send({
          chainId: chain.chainId,
          role: 'relayer',
          to: chain.deployment.gachaMachine,
          data: encodeFunctionData({abi: gachaAbi, functionName: 'flushRevenue', args: [token]}),
          idempotencyKey: `${chain.chainId}:${token}:flush:${Math.floor(Date.now() / 3_600_000)}`,
          kind: 'flushRevenue',
        });
      } catch {
        // Nothing pending is the common case and is not an error.
      }
    }
  }
}

/**
 * Starts the worker loops. Exported so the development entrypoint can run them IN-PROCESS alongside
 * the API — the embedded database is single-writer, so two processes cannot open it at once.
 * In production the API and the workers are separate deployments against a real Postgres.
 */
export function startWorkers(): Promise<unknown> {
  logger.info('workers starting');
  return Promise.all([
    loop('indexer', config.INDEXER_INTERVAL_MS, indexAllChains),
    loop('reconciler', config.RECONCILER_INTERVAL_MS, reconcileAllChains),
    loop('settler', 15_000, settleRevealedDraws),
    loop('revenue', 300_000, flushRevenue),
  ]);
}

export function stopWorkers(): void {
  running = false;
}

async function main(): Promise<void> {
  assertComplianceModeIsSafe(initChains());
  await initSigners();

  const stop = async () => {
    stopWorkers();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());

  await startWorkers();
}

// Only self-start when this file is the process entrypoint. When the API imports `startWorkers`,
// this must stay dormant.
const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    logger.fatal({err}, 'workers failed to start');
    process.exit(1);
  });
}
