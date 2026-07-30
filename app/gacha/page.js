"use client";

import { useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useQueryClient } from "@tanstack/react-query";
import HomeHero from "../components/home/HomeHero";
import FeaturedDrops from "../components/home/FeaturedDrops";
import PackOpenModal from "../components/home/PackOpenModal";
import { useSession } from "../hooks/useSession";
import { useRipFlow } from "../hooks/useRipFlow";
import { api } from "../lib/api";
import { usePack } from "../hooks/usePack";
import ClaimTokens from "../components/ClaimTokens";

/**
 * The gacha page.
 *
 * Availability is decided from three independent facts, and the reason a pack cannot be opened is
 * always stated rather than left as a greyed-out button:
 *   1. is this chain even allowed to run a draw (VRF present — spec §3);
 *   2. is the user signed in;
 *   3. does their verified jurisdiction and age permit a paid draw (spec §12).
 *
 * The final say is always the backend's at the moment of purchase; this is the UI mirroring it.
 */
export default function GachaPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const { open: openWalletModal } = useAppKit();
  const { isAuthenticated, compliance, refresh: refreshSession, signIn } = useSession();
  const [signingIn, setSigningIn] = useState(false);

  const queryClient = useQueryClient();

  // Shared with the landing page. Both render this hero, and keeping two copies of the "which pack"
  // logic is precisely how the landing page ended up permanently blank.
  const { chain, pack, displayChainId, onWrongNetwork, targetChain } = usePack();

  const flow = useRipFlow({ chainId: pack?.chainId ?? chainId, packId: pack?.packId });

  // Mirrors the backend's gate so the UI explains itself, but the backend always re-decides at the
  // money action — this is presentation, never authorisation.
  const mode = compliance?.mode ?? "full";
  const needsAgeAttestation = mode === "age_only" && !compliance?.ageVerified;

  const blockedReason = (() => {
    if (chain && !chain.gachaEnabled) {
      return (
        chain.marketplaceOnlyReason ??
        `${chain.name} has no verifiable randomness, so packs are not sold here. The marketplace works normally.`
      );
    }
    if (!isConnected) return "Connect a wallet to open packs.";
    if (onWrongNetwork) {
      return `Your wallet is on network ${chainId}, which this deployment does not serve.${
        targetChain ? ` Switch to ${targetChain.name}.` : ""
      }`;
    }
    if (!isAuthenticated) return "Sign in to continue.";
    if (compliance?.selfExcludedUntil) {
      return `Self-exclusion is active until ${new Date(compliance.selfExcludedUntil).toLocaleDateString()}.`;
    }
    if (needsAgeAttestation) return null; // handled by the confirm-age control below
    if (mode === "full" && compliance?.kycStatus !== "approved") {
      return "Packs are a game of chance, so we verify identity and age before a paid draw.";
    }
    if (!pack) return "No pack is currently active on this network.";
    return null;
  })();

  /**
   * The one blocker the user can clear from this button, paired with the control that clears it.
   *
   * Connecting and switching networks already have their own controls in the header, so duplicating
   * them here would give two places to do the same thing. Signing in has none — the CTA was the only
   * surface mentioning it, and it was disabled.
   */
  const action = (() => {
    if (isConnected && !onWrongNetwork && !isAuthenticated) {
      return {
        label: signingIn ? "Check your wallet…" : "Sign in",
        onClick: async () => {
          setSigningIn(true);
          try {
            await signIn();
          } catch {
            /* surfaced by useSession */
          } finally {
            setSigningIn(false);
          }
        },
      };
    }
    return null;
  })();

  const confirmAge = async () => {
    await api.attestAge(18);
    await refreshSession();
  };

  const openPack = async () => {
    setModalOpen(true);
    await flow.open(1);
  };

  const handleKeep = async (draw) => {
    if (!draw?.drawId) return;
    try {
      await flow.keep(draw.drawId);
      // The card has just moved out of the vault into the user's wallet; anything showing holdings
      // is now stale.
      void queryClient.invalidateQueries({ queryKey: ["myCards"] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    } catch {
      /* the draw is still the user's; claimAfterTimeout delivers it regardless */
    }
  };

  const handleSellBack = async (draw) => {
    if (!draw?.drawId) return;
    try {
      await flow.sellBack(draw.drawId);
      setModalOpen(false);
    } catch {
      /* surfaced inside the modal */
    }
  };

  return (
    <main className="relative min-h-screen">
      {/* A build with the gate disabled must never be mistakable for a live one. */}
      {mode === "off" && (
        <div className="fixed top-0 inset-x-0 z-[60] bg-[#FFD36B] text-[#1a1200] text-[12.5px] font-semibold text-center py-1.5">
          TESTNET — identity checks are disabled and no real money is involved
        </div>
      )}

      {needsAgeAttestation && (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="glass rounded-2xl p-7 max-w-[420px] text-center">
            <h2 className="text-white font-semibold text-[18px] mb-2">Before you open a pack</h2>
            <p className="text-white/55 text-[13.5px] leading-[1.6] mb-5">
              Packs contain a randomly selected card. Please confirm you are at least 18.
            </p>
            <button
              onClick={confirmAge}
              className="holo-cta relative w-full rounded-2xl py-3.5 font-semibold text-[15px] text-white"
            >
              <span className="relative z-[1]">I confirm I am 18 or over</span>
            </button>
          </div>
        </div>
      )}

      {onWrongNetwork && targetChain && (
        <div className="fixed top-0 inset-x-0 z-[60] bg-[#ff6b6b] text-[#2a0000] text-[12.5px] font-semibold flex items-center justify-center gap-3 py-1.5">
          <span>Wrong network — your wallet is on chain {chainId}</span>
          <button
            onClick={() => openWalletModal({ view: "Networks" })}
            className="underline underline-offset-2 hover:opacity-80"
          >
            Switch to {targetChain.name}
          </button>
        </div>
      )}

      <HomeHero
        onOpen={blockedReason ? undefined : openPack}
        pack={pack}
        disabled={Boolean(blockedReason)}
        blockedReason={blockedReason}
        action={action}
        chainId={isAuthenticated ? chainId : undefined}
      />
      {chain?.faucet && (
        <div className="max-w-[420px] mx-auto px-6 -mt-6 mb-10">
          <ClaimTokens faucet={chain.faucet} pack={pack} />
        </div>
      )}
      <FeaturedDrops />
      <PackOpenModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        flow={flow}
        pack={pack}
        onKeep={handleKeep}
        // The sell-back option is only offered where the product actually has one. In `age_only` mode
        // there is no cash-out leg at all, so showing the button would promise something the backend
        // would then refuse.
        onSellBack={mode === "age_only" ? undefined : handleSellBack}
      />
    </main>
  );
}
