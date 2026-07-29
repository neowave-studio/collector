"use client";

import { useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useSession } from "../hooks/useSession";
import { chainName } from "../lib/wagmi";

function shorten(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Wallet + session control.
 *
 * Reown AppKit owns wallet selection and network switching, so this only handles the second step the
 * modal knows nothing about: signing in to our API. Those are genuinely separate — connecting proves
 * you hold a key, signing in gives you a session, and NEITHER authorises a payment. Every purchase is
 * signed separately against terms the user can read.
 */
export default function ConnectButton({ className = "" }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { open } = useAppKit();
  const { isAuthenticated, signIn, signOut, compliance } = useSession();

  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isConnected) {
    return (
      <button
        onClick={() => open()}
        className={`px-6 py-2.5 font-[700] text-[16px] text-white nav-active rounded-[12px] border border-[#FFFFFF47] ${className}`}
      >
        Connect Wallet
      </button>
    );
  }

  if (!isAuthenticated) {
    return (
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await signIn();
          } catch {
            /* surfaced by useSession */
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className={`px-6 py-2.5 font-[700] text-[16px] text-white nav-active rounded-[12px] border border-[#FFFFFF47] disabled:opacity-60 ${className}`}
      >
        {busy ? "Check your wallet…" : "Sign in"}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className={`px-5 py-2.5 font-[700] text-[15px] text-white nav-active rounded-[12px] border border-[#FFFFFF47] flex items-center gap-2 ${className}`}
      >
        <span className="w-2 h-2 rounded-full bg-[#2BD383]" />
        {shorten(address)}
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-2 w-64 glass-menu rounded-2xl p-3 z-50 space-y-2.5">
          <button
            onClick={() => {
              open({ view: "Networks" });
              setMenuOpen(false);
            }}
            className="w-full text-left px-3 py-2 rounded-xl text-[13.5px] text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            Network · <span className="text-white/50">{chainName(chainId)}</span>
          </button>

          <button
            onClick={() => {
              open({ view: "Account" });
              setMenuOpen(false);
            }}
            className="w-full text-left px-3 py-2 rounded-xl text-[13.5px] text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            Wallet details
          </button>

          {compliance && (
            <div className="border-t border-white/10 pt-2.5 px-3">
              <p className="font-mono-data text-[10px] tracking-[0.2em] uppercase text-white/40 mb-1.5">
                Verification
              </p>
              <p className="text-[12.5px] text-white/70 leading-[1.5]">
                {compliance.mode === "off"
                  ? "Testnet — identity checks disabled"
                  : compliance.kycStatus === "approved"
                    ? `Verified${compliance.jurisdiction ? ` · ${compliance.jurisdiction}` : ""}`
                    : compliance.mode === "age_only"
                      ? "Age confirmation required"
                      : "Verification required before opening packs"}
              </p>
            </div>
          )}

          <button
            onClick={() => {
              void signOut();
              setMenuOpen(false);
            }}
            className="w-full text-left px-3 py-2 rounded-xl text-[13px] text-white/55 hover:text-white hover:bg-white/[0.06] border-t border-white/10 pt-2.5"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
