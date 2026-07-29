"use client";

import { useState } from "react";
import { formatUnits } from "../lib/api";

/**
 * Odds disclosure (spec §12 [MUST]).
 *
 * Several jurisdictions legally require loot-box odds to be disclosed at the point of purchase. Ours
 * go further than a printed percentage: the exact pool version, Merkle root and IPFS CID shown here
 * are the ones the contract will bind at rip time, so a user can walk away and check that the odds
 * they were shown are the odds that were committed — without taking our word for any of it.
 */
export default function OddsDisclosure({ pack }) {
  const [expanded, setExpanded] = useState(false);
  if (!pack) return null;

  const total = Number(pack.totalWeight || 1);

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono-data text-[11px] tracking-[0.25em] uppercase text-white/50">
          Pull odds
        </span>
        <span className="font-mono-data text-[11px] text-white/30">
          committed on-chain · v{pack.poolVersion}
        </span>
      </div>

      <div className="flex h-2.5 rounded-full overflow-hidden mb-5 bg-white/[0.06]">
        {pack.odds?.map((tier, i) => (
          <div
            key={tier.priceRef}
            style={{
              width: `${(Number(tier.weight) / total) * 100}%`,
              background:
                i === pack.odds.length - 1
                  ? "linear-gradient(90deg,#2BD383,#A3FFD3)"
                  : ["#4b5158", "#6B8AFF", "#FFD36B"][i] ?? "#4b5158",
            }}
          />
        ))}
      </div>

      <div className="space-y-2.5">
        {pack.odds?.map((tier) => (
          <div key={tier.priceRef} className="flex items-center justify-between">
            <span className="text-white/85 text-[13px] md:text-[14px] font-medium">
              {tier.cards} card{tier.cards === 1 ? "" : "s"} @ ${formatUnits(tier.priceRef, 6)}
            </span>
            <span className="text-white/70 text-[12px] md:text-[13px] font-semibold tabular-nums">
              {(tier.probability * 100).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="link-underline text-white/45 hover:text-white text-[12.5px] mt-4"
      >
        {expanded ? "Hide proof details" : "How do I know these odds are real?"}
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-2 font-mono-data text-[11px] text-white/45 leading-[1.7]">
          <p className="text-white/60 font-sans text-[12.5px] leading-[1.55]">
            The contract built this Merkle root itself from a list it verified covers every outcome
            exactly once — no gaps, no overlaps, no card listed twice. It is write-once, so these odds
            cannot be edited after you buy. Rebuild the root from the published file and compare.
          </p>
          <div className="break-all">root: {pack.merkleRoot}</div>
          <div className="break-all">pool file: {pack.poolCid}</div>
          <div>
            reference prices: {pack.priceRefProvenance?.source} @{" "}
            {pack.priceRefProvenance?.snapshotAt
              ? new Date(pack.priceRefProvenance.snapshotAt).toISOString().slice(0, 10)
              : "—"}
          </div>
          <div>instant sell-back: up to {(pack.buybackBps / 100).toFixed(0)}% of reference value</div>
          <a className="link-underline text-white/70 inline-block pt-1" href="/verify">
            Open the offline verifier →
          </a>
        </div>
      )}
    </div>
  );
}
