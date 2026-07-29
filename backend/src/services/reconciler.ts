import {encodeFunctionData} from 'viem';
import {allChains, type ChainContext} from '../chains.js';
import {gachaAbi, reserveVaultAbi, erc20Abi} from '../lib/abi.js';
import {query, withAdvisoryLock} from '../db/index.js';
import {alert, logger} from '../lib/logger.js';
import {config} from '../config.js';
import {getSigner} from './signer.js';
import {createWalletClient, http} from 'viem';

/**
 * Chain↔DB reconciler with auto-pause (spec §2, §8.3, FIX C3-backend).
 *
 * The DB is a cache of on-chain truth. Divergence therefore means one of three things, all of them
 * serious: the indexer missed or mis-applied an event, an unexpected actor moved funds, or a bug is
 * double-counting liabilities. None of those are safe to keep selling into, so the response is to
 * PAUSE THE BUYBACK PATH and page a human — not to log a warning and continue.
 *
 * The pause is on-chain (`ReserveVault.pause()`), which stops payouts and new reservations while
 * leaving `unreserve`, `claimAfterTimeout`, `claimUnavailable` and `refundStuckRip` working. That
 * asymmetry is the point: an incident must never strand a user who already paid.
 */

interface LedgerRow {
  token: string;
  reserved: string;
  paid: string;
  funded: string;
}

export interface ReconcileReport {
  chainId: number;
  token: string;
  chainReserved: bigint;
  dbReserved: bigint;
  chainBalance: bigint;
  solvent: boolean;
  diverged: boolean;
}

export async function reconcileChain(chain: ChainContext): Promise<ReconcileReport[]> {
  if (!chain.gachaEnabled) return [];

  const reports: ReconcileReport[] = [];
  const rows = await query<LedgerRow>('SELECT token, reserved, paid, funded FROM reserve_ledger WHERE chain_id = $1', [
    chain.chainId,
  ]);

  /**
   * Compare like against like.
   *
   * The database is not a live mirror of the chain and is not meant to be: the indexer stops at
   * `head - confirmations` on purpose, so during any activity the DB is legitimately a few blocks
   * behind. Reading the contract at *head* and comparing it to that DB therefore reports divergence
   * for every rip in flight — first one way while the reservation is unindexed, then the other way
   * after settlement. Both are the reconciler racing the indexer, not a real discrepancy.
   *
   * That matters because divergence is not just noise here: it trips the auto-pause, which halts
   * buyback and new rips. A watchdog that fires on healthy traffic is worse than none, because the
   * one real event gets lost among the false ones.
   *
   * So pin every read to the block the indexer has actually reached. Anything still unindexed is
   * simply not yet in scope, and a genuine discrepancy at that block stays visible.
   */
  const cursorRow = await query<{last_indexed_block: string}>(
    'SELECT last_indexed_block FROM chains WHERE chain_id = $1',
    [chain.chainId],
  );
  const atBlock = BigInt(cursorRow[0]?.last_indexed_block ?? '0');
  // Nothing indexed yet means there is no baseline to compare against, not that everything diverged.
  if (atBlock === 0n) return [];

  for (const row of rows) {
    const token = row.token as `0x${string}`;

    const [chainReserved, chainBalance] = await Promise.all([
      chain.client.readContract({
        address: chain.deployment.reserveVault,
        abi: reserveVaultAbi,
        functionName: 'reservedLiabilities',
        args: [token],
        blockNumber: atBlock,
      }),
      chain.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [chain.deployment.reserveVault],
        blockNumber: atBlock,
      }),
    ]);

    const dbReserved = BigInt(row.reserved);
    const diverged = chainReserved !== dbReserved;
    const solvent = chainBalance >= chainReserved;

    reports.push({chainId: chain.chainId, token, chainReserved, dbReserved, chainBalance, solvent, diverged});

    // Keep the public proof-of-reserves figure fresh regardless of the outcome.
    await query(
      `UPDATE reserve_ledger SET balance_snapshot = $3, updated_at = now()
        WHERE chain_id = $1 AND token = $2`,
      [chain.chainId, token, chainBalance.toString()],
    );

    if (!solvent) {
      // The on-chain invariant makes this state unreachable through the contracts themselves, so
      // observing it means something outside them is wrong. Highest-severity path.
      await recordAndPause(chain, token, chainReserved, dbReserved, 'insolvent_reserve');
      continue;
    }

    if (diverged) {
      await recordAndPause(chain, token, chainReserved, dbReserved, 'reserve_divergence');
    }
  }

  await checkStuckDraws(chain);
  await checkOutflowRate(chain);

  return reports;
}

async function recordAndPause(
  chain: ChainContext,
  token: string,
  chainValue: bigint,
  dbValue: bigint,
  reason: string,
): Promise<void> {
  await query(
    `INSERT INTO reconciliation_events (chain_id, token, chain_value, db_value, action)
     VALUES ($1,$2,$3,$4,$5)`,
    [chain.chainId, token, chainValue.toString(), dbValue.toString(), reason],
  );

  await alert(reason, {
    chainId: chain.chainId,
    token,
    chainReserved: chainValue.toString(),
    dbReserved: dbValue.toString(),
  });

  if (!config.RECONCILER_AUTOPAUSE) {
    logger.warn({chainId: chain.chainId, token}, 'auto-pause disabled by configuration; NOT pausing buyback');
    return;
  }

  await pauseBuyback(chain, reason);
}

/**
 * Pauses the ReserveVault, which halts buyback payouts and new rips (a rip cannot reserve while
 * paused) without touching the user escape hatches.
 */
export async function pauseBuyback(chain: ChainContext, reason: string): Promise<void> {
  const alreadyPaused = await chain.client.readContract({
    address: chain.deployment.reserveVault,
    abi: reserveVaultAbi,
    functionName: 'paused',
  });
  if (alreadyPaused) return;

  try {
    // PAUSE_ADMIN_ROLE must be granted to the relayer key for this to work. If it is not, the alert
    // above still fires and a human pauses from the Safe — the automation is an accelerator, not the
    // only control.
    const signer = getSigner('relayer');
    const wallet = createWalletClient({
      account: signer.account,
      transport: http(chain.rpcUrl),
      chain: {
        id: chain.chainId,
        name: chain.name,
        nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18},
        rpcUrls: {default: {http: [chain.rpcUrl]}},
      },
    });
    const hash = await wallet.sendTransaction({
      account: signer.account,
      chain: null,
      to: chain.deployment.reserveVault,
      data: encodeFunctionData({abi: reserveVaultAbi, functionName: 'pause'}),
    });

    await query(
      `UPDATE chains SET buyback_paused = TRUE, buyback_paused_reason = $2, updated_at = now()
        WHERE chain_id = $1`,
      [chain.chainId, reason],
    );
    await alert('buyback_auto_paused', {chainId: chain.chainId, reason, txHash: hash});
  } catch (err) {
    await alert('buyback_auto_pause_FAILED', {
      chainId: chain.chainId,
      reason,
      error: err instanceof Error ? err.message : String(err),
      action: 'PAUSE MANUALLY FROM THE SAFE NOW',
    });
  }
}

/** Draws whose randomness has not arrived well past the timeout (spec §8.7 "VRF-stuck draws"). */
async function checkStuckDraws(chain: ChainContext): Promise<void> {
  const timeout = await chain.client.readContract({
    address: chain.deployment.gachaMachine,
    abi: gachaAbi,
    functionName: 'ripRevealTimeout',
  });

  const stuck = await query<{draw_id: string; user_address: string}>(
    `SELECT draw_id, user_address FROM draws
      WHERE chain_id = $1 AND status = 'requested'
        AND created_at < now() - ($2 || ' seconds')::interval
      LIMIT 50`,
    [chain.chainId, timeout.toString()],
  );

  if (stuck.length > 0) {
    await alert('vrf_stuck_draws', {
      chainId: chain.chainId,
      count: stuck.length,
      drawIds: stuck.map((d) => d.draw_id),
      remedy: 'these draws are refundable via refundStuckRip, which anyone may call on the user behalf',
    });
  }
}

/** Buyback outflow approaching the on-chain per-epoch ceiling is an early drain signal (§8.7). */
async function checkOutflowRate(chain: ChainContext): Promise<void> {
  const rows = await query<{token: string}>('SELECT token FROM reserve_ledger WHERE chain_id = $1', [chain.chainId]);

  for (const {token} of rows) {
    const [remaining, cap] = await Promise.all([
      chain.client.readContract({
        address: chain.deployment.reserveVault,
        abi: reserveVaultAbi,
        functionName: 'outflowRemaining',
        args: [token as `0x${string}`],
      }),
      chain.client.readContract({
        address: chain.deployment.reserveVault,
        abi: reserveVaultAbi,
        functionName: 'maxBuybackOutflowPerEpoch',
        args: [token as `0x${string}`],
      }),
    ]);

    if (cap === 0n) {
      await alert('buyback_outflow_cap_unconfigured', {
        chainId: chain.chainId,
        token,
        impact: 'buyback is fully blocked on this token until a cap is set through the Timelock',
      });
      continue;
    }

    const used = cap - remaining;
    if (used * 100n >= cap * 80n) {
      await alert('buyback_outflow_epoch_near_cap', {
        chainId: chain.chainId,
        token,
        usedPct: Number((used * 100n) / cap),
        cap: cap.toString(),
      });
    }
  }
}

export async function reconcileAllChains(): Promise<void> {
  await withAdvisoryLock('reconciler', async () => {
    for (const chain of allChains()) {
      try {
        await reconcileChain(chain);
      } catch (err) {
        logger.error({err, chainId: chain.chainId}, 'reconciler pass failed');
      }
    }
  });
}
