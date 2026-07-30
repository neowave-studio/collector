"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useChainId } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useSession } from "../hooks/useSession";
import { chainName } from "../lib/wagmi";
import { api } from "../lib/api";

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
  const router = useRouter();
  const { open } = useAppKit();
  const { isAuthenticated, signIn, signOut, compliance, refresh } = useSession();

  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [excluding, setExcluding] = useState(false);
  const [busyExclude, setBusyExclude] = useState(false);
  const ref = useRef(null);

  const confirmExclude = async () => {
    setBusyExclude(true);
    try {
      await api.selfExclude(30);
      await refresh();
      setExcluding(false);
    } catch {
      /* keep the confirm open; the toggle can be retried */
    } finally {
      setBusyExclude(false);
    }
  };

  // Close the account menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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
    <div className="relative" ref={ref}>
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

          <button
            onClick={() => {
              router.push(`/profile/${address}`);
              setMenuOpen(false);
            }}
            className="w-full text-left px-3 py-2 rounded-xl text-[13.5px] text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            My profile
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

          {/* Responsible play — self-exclusion */}
          <div className="border-t border-white/10 pt-2.5 px-3">
            {compliance?.selfExcludedUntil ? (
              <p className="text-[12.5px] text-[#FFD36B] leading-[1.5]">
                Self-excluded until{" "}
                {new Date(compliance.selfExcludedUntil).toLocaleDateString()}
              </p>
            ) : excluding ? (
              <div>
                <p className="text-[12px] text-white/60 leading-[1.5] mb-2">
                  Pause paid draws for 30 days? You can still trade and redeem.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={confirmExclude}
                    disabled={busyExclude}
                    className="flex-1 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-[#ff8080] bg-[#ff5a5a]/15 hover:bg-[#ff5a5a]/25 disabled:opacity-60"
                  >
                    {busyExclude ? "Excluding…" : "Exclude 30 days"}
                  </button>
                  <button
                    onClick={() => setExcluding(false)}
                    className="px-3 py-1.5 rounded-lg text-[12.5px] text-white/60 hover:text-white hover:bg-white/[0.06]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setExcluding(true)}
                className="w-full text-left text-[12.5px] text-white/45 hover:text-white/80 transition-colors"
              >
                Take a break — self-exclude
              </button>
            )}
          </div>

          <div className="border-t border-white/10 pt-2.5">
            <button
              onClick={() => {
                void signOut();
                setMenuOpen(false);
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-[13px] font-semibold text-[#ff8080] bg-[#ff5a5a]/12 hover:bg-[#ff5a5a]/22 hover:text-[#ff9d9d] transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
