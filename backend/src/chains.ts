import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicClient, http, type Address, type PublicClient} from 'viem';
import {config} from './config.js';

const here = dirname(fileURLToPath(import.meta.url));

export interface ChainVrf {
  coordinator: Address;
  keyHash: `0x${string}`;
  nativePayment: boolean;
  requestConfirmations: number;
  callbackGasLimit: number;
}

export interface ChainEntry {
  key: string;
  chainId: number;
  name: string;
  priority: number;
  testnet?: boolean;
  /** False => MARKETPLACE ONLY. Spec §3 [FIX H6]: no VRF, no real-money gacha. */
  gachaEnabled: boolean;
  marketplaceOnlyReason?: string;
  vrf: ChainVrf | null;
  permit2: Address | null;
  payTokens: Record<string, Address>;
  /** Set ABOVE the chain's observed reorg depth (spec §8.4 FIX L5-backend). */
  confirmations: number;
  moonpayCurrency: string | null;
  explorer: string | null;
  /** Per-chain `eth_getLogs` span; providers cap this very differently. */
  logBatchSize?: number;
  /**
   * Self-service test-token faucet, or null where there is none.
   *
   * Surfaced to the frontend so the claim button appears only where a faucet actually exists — and,
   * more importantly, never on a chain where the pay token is real money.
   */
  faucet?: {
    token: Address;
    symbol: string;
    decimals: number;
    claimAmount: string;
    cooldownHours: number;
  } | null;
}

export interface Deployment {
  chainId: number;
  chainKey: string;
  gachaEnabled: boolean;
  factory: Address;
  timelock: Address;
  accessController: Address;
  collectibleNFT: Address;
  vault: Address;
  reserveVault: Address;
  paymentRouter: Address;
  marketplace: Address;
  gachaMachine: Address;
  /**
   * Block the contracts were deployed in.
   *
   * The indexer walks forward from `chains.last_indexed_block`, which starts at 0 — and a real chain
   * is millions of blocks old, so an unset cursor means scanning from genesis in small batches and
   * never reaching the present. Recorded here rather than rediscovered because it is a fact about
   * the deployment, and binary-searching eth_getCode on every boot would be a strange way to learn
   * something we already know.
   */
  deployBlock?: number;
}

export interface ChainContext extends ChainEntry {
  rpcUrl: string;
  client: PublicClient;
  deployment: Deployment;
}

const RPC_ENV: Record<string, string> = {
  anvil: 'ANVIL_RPC_URL',
  base: 'BASE_RPC_URL',
  base_sepolia: 'BASE_SEPOLIA_RPC_URL',
  ethereum_sepolia: 'ETHEREUM_SEPOLIA_RPC_URL',
  bnb_testnet: 'BNB_TESTNET_RPC_URL',
  polygon: 'POLYGON_RPC_URL',
  arbitrum: 'ARBITRUM_RPC_URL',
  bnb: 'BNB_RPC_URL',
  ethereum: 'ETHEREUM_RPC_URL',
  robinhood: 'ROBINHOOD_RPC_URL',
};

function loadRegistry(): ChainEntry[] {
  const path = join(here, '../../contracts/script/chains.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {chains: ChainEntry[]};
  return raw.chains;
}

/**
 * `deployments/<key>.json` is written by `Deploy.s.sol` and MUST be signed before it is shipped to
 * the frontend (spec §3 FIX L4-backend). The signature check lives in the frontend's registry loader;
 * here we only assert internal consistency, so a mismatched file cannot silently point the backend at
 * the wrong contracts.
 */
function loadDeployment(entry: ChainEntry): Deployment {
  const path = join(here, `../../contracts/deployments/${entry.key}.json`);
  const deployment = JSON.parse(readFileSync(path, 'utf8')) as Deployment;
  if (deployment.chainId !== entry.chainId) {
    throw new Error(
      `deployments/${entry.key}.json declares chainId ${deployment.chainId} but the registry says ${entry.chainId}`,
    );
  }
  if (entry.gachaEnabled && !deployment.gachaMachine) {
    throw new Error(`Chain ${entry.key} has gachaEnabled but no GachaMachine address in its deployment file`);
  }
  return deployment;
}

const contexts = new Map<number, ChainContext>();

export function initChains(): ChainContext[] {
  const registry = loadRegistry();

  for (const key of config.ENABLED_CHAINS) {
    const entry = registry.find((c) => c.key === key);
    if (!entry) throw new Error(`ENABLED_CHAINS references unknown chain "${key}"`);
    if (entry.chainId === 0) {
      throw new Error(
        `Chain "${key}" is a placeholder in chains.json (chainId 0). Fill in its real chainId, RPC and ` +
          `token addresses before enabling it.`,
      );
    }

    const rpcEnvKey = RPC_ENV[key];
    const rpcUrl = rpcEnvKey ? process.env[rpcEnvKey] : undefined;
    if (!rpcUrl) throw new Error(`Missing ${rpcEnvKey ?? `RPC url for ${key}`}`);

    const client = createPublicClient({transport: http(rpcUrl)}) as PublicClient;
    contexts.set(entry.chainId, {...entry, rpcUrl, client, deployment: loadDeployment(entry)});
  }

  if (contexts.size === 0) throw new Error('No chains enabled — set ENABLED_CHAINS');
  return [...contexts.values()];
}

export function getChain(chainId: number): ChainContext {
  const ctx = contexts.get(chainId);
  if (!ctx) throw new Error(`Chain ${chainId} is not served by this deployment`);
  return ctx;
}

/**
 * Whether this process serves a chain at all.
 *
 * One database backs every chain, and rows are keyed by `chain_id` — so it routinely holds data for
 * chains this process is not configured for: a chain removed from `ENABLED_CHAINS`, or one seeded
 * ahead of being enabled. Any route that fans out from a database row to `getChain()` has to skip
 * those, or a single stale row turns the whole endpoint into a 500.
 */
export function isChainServed(chainId: number): boolean {
  return contexts.has(chainId);
}

export function allChains(): ChainContext[] {
  return [...contexts.values()];
}

/** Chains where a paid draw may be offered at all. */
export function gachaChains(): ChainContext[] {
  return allChains().filter((c) => c.gachaEnabled);
}
