import {createWalletClient, http, type Hex, type WalletClient, type TransactionReceipt} from 'viem';
import {getChain, type ChainContext} from '../chains.js';
import {getSigner, type SignerRole} from './signer.js';
import {logger, alert} from '../lib/logger.js';
import * as idem from '../lib/idempotency.js';
import {asChainError} from '../lib/chain-errors.js';

/**
 * Transaction submission with nonce, gas, retry and reorg handling (spec §8.1 "Relayer").
 *
 * The relayer is a hot key, so its blast radius is deliberately small: on-chain it may only call
 * `rip` and `settle`. It cannot withdraw the reserve, change the treasury, or upgrade anything —
 * those all require the Timelock. A fully compromised relayer can waste gas and grief settlements;
 * it cannot take user funds.
 */

interface SendArgs {
  chainId: number;
  role: SignerRole;
  to: Hex;
  data: Hex;
  /** Idempotency key. The transaction is skipped entirely if this key is already owned. */
  idempotencyKey: string;
  kind: string;
  /** Optional simulation. Strongly preferred: a revert caught here costs nothing. */
  simulate?: () => Promise<void>;
}

const walletClients = new Map<string, WalletClient>();

function walletFor(chain: ChainContext, role: SignerRole): WalletClient {
  const cacheKey = `${chain.chainId}:${role}`;
  const cached = walletClients.get(cacheKey);
  if (cached) return cached;

  const client = createWalletClient({
    account: getSigner(role).account,
    transport: http(chain.rpcUrl),
    chain: {
      id: chain.chainId,
      name: chain.name,
      nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18},
      rpcUrls: {default: {http: [chain.rpcUrl]}},
    },
  });
  walletClients.set(cacheKey, client);
  return client;
}

export interface SendResult {
  txHash: Hex;
  /** True when this call was a no-op because the action had already been performed. */
  deduplicated: boolean;
}

export async function send(args: SendArgs): Promise<SendResult | null> {
  const chain = getChain(args.chainId);

  const claimed = await idem.claim(args.idempotencyKey, args.chainId, args.kind);
  if (!claimed) {
    const existing = await idem.get(args.idempotencyKey);
    logger.info({key: args.idempotencyKey, state: existing?.state}, 'idempotency key already owned; skipping');
    return existing?.tx_hash ? {txHash: existing.tx_hash as Hex, deduplicated: true} : null;
  }

  try {
    // Simulating first turns "the user was charged gas for a revert" into "we returned a 4xx".
    if (args.simulate) {
      try {
        await args.simulate();
      } catch (err) {
        // Translate here rather than at the route: a revert during simulation means nothing was
        // sent and nothing was charged, which is exactly the promise the 4xx makes. Reverts seen
        // after broadcast are a different situation and are not routed through this path.
        throw asChainError(err);
      }
    }

    const wallet = walletFor(chain, args.role);
    const txHash = await wallet.sendTransaction({
      account: getSigner(args.role).account,
      chain: null,
      to: args.to,
      data: args.data,
    });

    await idem.markSubmitted(args.idempotencyKey, txHash);
    logger.info({chainId: args.chainId, kind: args.kind, txHash}, 'transaction submitted');

    void confirmInBackground(chain, args.idempotencyKey, txHash);
    return {txHash, deduplicated: false};
  } catch (err) {
    await idem.markFailed(args.idempotencyKey, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Waits for the chain's configured `confirmations` before marking the key terminal.
 * Anything shallower is not a settled fact — see §8.4 and the per-chain depths in `chains.json`.
 */
async function confirmInBackground(chain: ChainContext, key: string, txHash: Hex): Promise<void> {
  try {
    const receipt: TransactionReceipt = await chain.client.waitForTransactionReceipt({
      hash: txHash,
      confirmations: chain.confirmations,
      timeout: 10 * 60_000,
    });

    if (receipt.status === 'success') {
      await idem.markConfirmed(key, receipt.blockNumber, {blockNumber: receipt.blockNumber.toString()});
    } else {
      await idem.markFailed(key, 'transaction reverted on chain');
      await alert('tx_reverted', {chainId: chain.chainId, txHash, key});
    }
  } catch (err) {
    // Not marked failed: the transaction may still land. The reconciler and the indexer will pick it
    // up, and the on-chain single-settlement guard makes a duplicate submission harmless.
    logger.warn({err, txHash, key}, 'confirmation wait ended without a receipt');
  }
}
