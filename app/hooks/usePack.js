"use client";

import { useMemo } from "react";
import { useAccount, useChainId } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { DEFAULT_CHAIN_ID } from "../lib/wagmi";

/**
 * The active pack for the chain the user is on, plus the network facts that decide whether it is
 * buyable.
 *
 * Extracted because the home page and the gacha page both show this hero and had drifted: the gacha
 * page loaded a live pack while `app/page.js` rendered `<HomeHero />` with no props at all, so the
 * landing page was permanently stuck in its empty state showing dashes. Every fix applied to one page
 * silently missed the other. One hook, one answer, no divergence.
 */
export function usePack() {
  const chainId = useChainId();
  const { isConnected } = useAccount();

  const { data: chains } = useQuery({queryKey: ["chains"], queryFn: api.chains});
  const { data: packs } = useQuery({queryKey: ["packs"], queryFn: api.packs});

  const servedChainIds = useMemo(() => new Set((chains ?? []).map((c) => c.chainId)), [chains]);
  const onWrongNetwork = isConnected && chains !== undefined && !servedChainIds.has(chainId);
  const targetChain = chains?.find((c) => c.gachaEnabled) ?? chains?.[0] ?? null;

  /**
   * Which chain's pack to DISPLAY — deliberately not the same question as where a transaction goes.
   *
   * `useChainId()` is restored from wagmi's cookie storage, so a browser that once selected a chain we
   * do not serve keeps reporting it, and while disconnected there is no wrong-network banner to explain
   * the resulting blank page. Falling back to the configured default means a visitor always sees a real
   * pack with its real committed odds.
   *
   * This must never influence what is bought. `onWrongNetwork` is computed from the ACTUAL chain, and
   * the gacha page blocks on it — otherwise the button would look usable while every transaction went
   * to the wrong network.
   */
  const displayChainId = servedChainIds.has(chainId) ? chainId : DEFAULT_CHAIN_ID;

  const chain = chains?.find((c) => c.chainId === displayChainId) ?? null;
  const pack = useMemo(
    () => packs?.find((p) => p.chainId === displayChainId) ?? null,
    [packs, displayChainId],
  );

  return {chainId, displayChainId, chains, chain, pack, servedChainIds, onWrongNetwork, targetChain};
}
