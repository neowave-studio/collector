"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { api } from "../lib/api";
import { SUPPORTED_CHAINS } from "../lib/wagmi";
import ChainIcon from "./ChainIcon";

/**
 * Network selector.
 *
 * The list comes from the backend's `/chains`, not from a constant here, because "which networks
 * exist" and "which networks this deployment actually serves" are different questions and only the
 * backend knows the second. A chain the API does not serve would render a pack the contract would
 * refuse to sell.
 *
 * Chains without Chainlink VRF are shown, not hidden — they are real places to trade, they just
 * cannot sell a random draw (spec §3 FIX H6). Hiding them would make the marketplace look broken;
 * labelling them explains it. The gacha page enforces the same distinction.
 */
export default function NetworkSwitcher({ className = "" }) {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  const { data: chains } = useQuery({
    queryKey: ["chains"],
    queryFn: api.chains,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!chains || chains.length === 0) return null;

  // A chain the wallet stack does not know about cannot be switched to, so offering it would be a
  // button that silently does nothing.
  const walletKnows = new Set(SUPPORTED_CHAINS.map((c) => c.id));
  const options = chains.filter((c) => walletKnows.has(c.chainId));
  if (options.length === 0) return null;

  /**
   * Order: the configured default first, then gacha chains, then the rest.
   *
   * `/chains` returns whatever order the backend enumerated, which is an implementation detail. The
   * chain we most want people on should be the first thing they see when they open the menu.
   */
  const preferred = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID);
  options.sort((a, b) => {
    if (a.chainId === preferred) return -1;
    if (b.chainId === preferred) return 1;
    return Number(b.gachaEnabled) - Number(a.gachaEnabled);
  });

  const active = options.find((c) => c.chainId === chainId);
  const onWrongNetwork = isConnected && !active;

  const pick = async (target) => {
    setError(null);
    setOpen(false);
    if (target.chainId === chainId) return;
    try {
      await switchChain({ chainId: target.chainId });
    } catch (err) {
      // Most wallets reject rather than auto-add an unknown network; say so instead of failing mute.
      setError(err?.shortMessage ?? err?.message ?? "Your wallet declined the network switch.");
    }
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className={`flex items-center gap-2 px-3.5 py-2.5 rounded-[12px] border text-[14px] font-semibold transition-colors disabled:opacity-60 ${
          onWrongNetwork
            ? "border-[#FFD36B]/50 bg-[#FFD36B]/10 text-[#FFD36B]"
            : "border-[#FFFFFF33] glass-soft text-white/85 hover:text-white"
        }`}
      >
        {onWrongNetwork ? (
          <span className="w-2 h-2 rounded-full bg-[#FFD36B]" />
        ) : (
          <ChainIcon chainId={active?.chainId} name={active?.name} size={18} />
        )}
        <span className="hidden sm:inline">
          {isPending ? "Switching…" : onWrongNetwork ? "Unsupported network" : (active?.name ?? "Network")}
        </span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="opacity-60">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[268px] glass rounded-xl border border-[#FFFFFF1A] overflow-hidden z-50">
          {options.map((c) => {
            const isActive = c.chainId === chainId;
            return (
              <button
                key={c.chainId}
                onClick={() => pick(c)}
                className={`w-full text-left px-4 py-3 transition-colors ${
                  isActive ? "bg-[#2BD383]/[0.08]" : "hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <ChainIcon chainId={c.chainId} name={c.name} size={20} />
                  <span className="text-white/90 text-[13.5px] font-semibold flex-1 truncate">{c.name}</span>
                  {isActive && <span className="text-[#2BD383] text-[11px] font-semibold">current</span>}
                </div>
                <p className="text-white/35 text-[11.5px] mt-1 ml-[30px] leading-[1.5]">
                  {c.gachaEnabled ? "Packs and marketplace" : "Marketplace only — no Chainlink VRF here"}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="absolute right-0 mt-2 w-[268px] text-[#ff6b6b] text-[11.5px] leading-[1.5] glass rounded-lg px-3 py-2 z-50">
          {error}
        </p>
      )}
    </div>
  );
}
