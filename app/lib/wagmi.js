"use client";

import { cookieStorage, createStorage, http } from "wagmi";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import {
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  mainnet,
  sepolia,
  polygon,
  arbitrum,
  anvil,
} from "@reown/appkit/networks";

/**
 * Wallet + chain configuration, built on Reown AppKit (formerly WalletConnect).
 *
 * AppKit supplies the connect modal — injected wallets, WalletConnect QR, mobile deep links — so this
 * file only decides WHICH networks exist and how to reach them.
 *
 * The backend's `/chains` endpoint remains the source of truth for which chains are actually live and
 * which are marketplace-only (no Chainlink VRF means no provably-fair draw, spec §3 FIX H6). The gacha
 * page reconciles against it, so the UI can never offer a pack on a chain where the contract would
 * refuse to sell one.
 *
 * The local devnet is only included when its RPC is configured, so a production build never advertises
 * a chain the user cannot reach. Robinhood Chain is deliberately absent until its chain id and RPC are
 * published — a placeholder would advertise a network nobody can transact on.
 */
export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

if (!projectId) {
  // Not fatal: injected wallets still work. But WalletConnect (and therefore every mobile wallet)
  // needs the project id, so say so loudly rather than letting it fail silently at connect time.
  console.warn(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set — WalletConnect and mobile wallets are disabled. " +
      "Get a project id at https://dashboard.reown.com",
  );
}

const LOCAL_DEVNET = process.env.NEXT_PUBLIC_ANVIL_RPC_URL ? [anvil] : [];

/**
 * Networks the wallet stack can be asked to switch to.
 *
 * The testnets are listed alongside the mainnets rather than swapped in by build flag, because this
 * list only says a chain is *reachable*. Which chains are actually live is `/chains`, and the
 * NetworkSwitcher intersects the two — so a chain here that the backend does not serve is simply
 * never offered.
 */
export const SUPPORTED_CHAINS = [
  ...LOCAL_DEVNET,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  mainnet,
  sepolia,
  polygon,
  arbitrum,
];

/**
 * Explicit RPC per chain.
 *
 * Left unset, AppKit routes every `eth_call` through Reown's hosted proxy at
 * `rpc.walletconnect.org`. That proxy authorises by project id AND origin, so a project that has not
 * whitelisted this origin answers 401 — and because reads go through it too, the failure is not
 * "wallet won't connect", it is a plain `allowance()` call failing mid-checkout with an opaque HTTP
 * error. It is also a third party in the path of every read.
 *
 * Wallet connection still uses Reown. Only the node we read from is pinned here.
 *
 * The defaults are public endpoints: fine for a rehearsal, rate-limited and unsuitable for
 * production. Override per chain with the NEXT_PUBLIC_*_RPC_URL variables before any real launch.
 */
const RPC_OVERRIDES = {
  [base.id]: process.env.NEXT_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org",
  [baseSepolia.id]: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
  [bsc.id]: process.env.NEXT_PUBLIC_BNB_RPC_URL ?? "https://bsc-dataseed.binance.org",
  [bscTestnet.id]: process.env.NEXT_PUBLIC_BNB_TESTNET_RPC_URL,
  [mainnet.id]: process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL,
  [sepolia.id]: process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL,
  [polygon.id]: process.env.NEXT_PUBLIC_POLYGON_RPC_URL ?? "https://polygon-rpc.com",
  [arbitrum.id]: process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
  [anvil.id]: process.env.NEXT_PUBLIC_ANVIL_RPC_URL,
};

const transports = Object.fromEntries(
  // `http(undefined)` falls back to the chain's own default RPC, which is the right behaviour for a
  // chain we have no opinion about — better than forcing everything through one proxy.
  SUPPORTED_CHAINS.map((chain) => [chain.id, http(RPC_OVERRIDES[chain.id])]),
);

export const wagmiAdapter = new WagmiAdapter({
  projectId: projectId ?? "",
  networks: SUPPORTED_CHAINS,
  transports,
  ssr: true,
  // Cookie storage keeps the connection across a server render, which avoids the flash of
  // "disconnected" on first paint.
  storage: createStorage({storage: cookieStorage}),
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

export const DEFAULT_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? baseSepolia.id
);

export function chainName(chainId) {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
}
