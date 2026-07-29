"use client";

import { useState } from "react";
import { api } from "../lib/api";

/**
 * Fiat on-ramp entry point (spec §9).
 *
 * This uses MoonPay's **on-ramp to the user's own wallet**, not NFT Checkout. The difference matters:
 * card payments stay reversible for months, so on-ramp leaves that fraud risk with MoonPay — who
 * priced it — instead of with our buyback reserve. The URL is signed server-side and the wallet
 * address comes from the session, never from the browser, so a payment cannot be credited elsewhere.
 *
 * The holdback notice is shown before the user commits, not discovered afterwards.
 */
export default function MoonPayButton({ chainId, amount = 100, className = "" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const buy = async () => {
    setLoading(true);
    setError(null);
    try {
      const { url, notice: holdbackNotice } = await api.moonpayUrl(chainId, amount);
      setNotice(holdbackNotice);
      window.open(url, "_blank", "noopener,noreferrer,width=460,height=720");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <button
        onClick={buy}
        disabled={loading}
        className="w-full glass-soft rounded-2xl px-4 py-3.5 text-[14px] font-semibold text-white/85 hover:text-white transition-colors border border-[#FFFFFF1A] disabled:opacity-50"
      >
        {loading ? "Opening MoonPay…" : "Buy USDC with card or Apple Pay"}
      </button>
      {notice && <p className="text-white/40 text-[12px] mt-2 leading-[1.5]">{notice}</p>}
      {error && <p className="text-[#ff6b6b] text-[12px] mt-2">{error}</p>}
    </div>
  );
}
