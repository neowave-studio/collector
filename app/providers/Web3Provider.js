"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { useState } from "react";
import { wagmiAdapter, projectId, SUPPORTED_CHAINS, DEFAULT_CHAIN_ID } from "../lib/wagmi";

// Created once at module scope — `createAppKit` registers a global singleton, so calling it inside a
// component would re-register it on every render.
if (projectId) {
  createAppKit({
    adapters: [wagmiAdapter],
    projectId,
    networks: SUPPORTED_CHAINS,
    defaultNetwork: SUPPORTED_CHAINS.find((c) => c.id === DEFAULT_CHAIN_ID) ?? SUPPORTED_CHAINS[0],
    metadata: {
      name: "Collector",
      description: "Provably-fair gacha packs and a marketplace for graded physical cards",
      url: typeof window === "undefined" ? "http://localhost:3000" : window.location.origin,
      icons: ["/logo.svg"],
    },
    features: {
      // Email and social sign-in create a custodial-ish wallet on the user's behalf. Off by default:
      // this product's whole claim is self-custody and self-recovery, and a wallet the user cannot
      // export undermines the escape hatches.
      email: false,
      socials: false,
      analytics: false,
    },
    themeMode: "dark",
    themeVariables: {
      "--w3m-accent": "#2BD383",
      "--w3m-border-radius-master": "3px",
    },
  });
}

export default function Web3Provider({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // On-chain state changes underneath us constantly (a draw reveals, a pool is
            // re-versioned), so cached reads are short-lived and refetched on focus.
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
