"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { formatUnits } from "../../lib/api";

/**
 * Pack-opening modal.
 *
 * The animation is unchanged, but what drives it is not: the reveal now waits for a real Chainlink
 * VRF word to land on-chain rather than a `setTimeout`. That distinction is the product — so the
 * "charging" state says what it is actually waiting for, and the reveal shows the committed odds
 * version and pool CID that bound the draw, which is also what several jurisdictions require to be
 * disclosed at the point of purchase (spec §12).
 */

/** Maps a card's committed reference value onto the existing rarity styling. */
function rarityFor(priceRef) {
  const value = Number(priceRef ?? 0) / 1e6;
  if (value >= 250) return { rarity: "S+", badge: "rarity-s", color: "#2BD383", label: "Epic" };
  if (value >= 110) return { rarity: "A+", badge: "rarity-a", color: "#FFD36B", label: "Rare" };
  if (value >= 60) return { rarity: "B", badge: "rarity-b", color: "#6B8AFF", label: "Uncommon" };
  return { rarity: "Ungraded", badge: "rarity-ungraded", color: "#8A8F98", label: "Common" };
}

const WAIT_COPY = {
  quoting: "Fetching the committed odds…",
  awaiting_approval: "Approve USDC spending in your wallet",
  awaiting_signature: "Confirm the terms in your wallet",
  submitting: "Submitting your rip…",
  awaiting_randomness: "Waiting for Chainlink VRF…",
};

/** Renders a duration the way someone would say it, rather than as a raw second count. */
function humanWindow(seconds) {
  if (!seconds) return null;
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} seconds`;
}

export default function PackOpenModal({ open, onClose, flow, pack, onKeep, onSellBack }) {
  const { phase, terms, error, txHash, draw, isBusy, reset } = flow;
  const [keeping, setKeeping] = useState(false);
  const windowLabel = humanWindow(pack?.buybackWindowSeconds);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const card = draw?.card ?? null;
  const rarity = rarityFor(card?.priceRef);
  const waiting = isBusy;

  const close = () => {
    reset();
    onClose();
  };

  return (
    <div className="pack-overlay" role="dialog" aria-modal="true" aria-label="Opening pack">
      <button className="pack-close" onClick={close} aria-label="Close">
        ✕
      </button>

      {waiting && (
        <>
          <div className={`pack-machine ${phase === "awaiting_randomness" ? "charging" : "charging"}`}>
            <div className="pack-aura" />
            <img
              src="/productimage.png"
              alt="Elite Pokémon Gacha Pack"
              className="pack-img"
              draggable="false"
            />
            <div className="holo-sheen" />
          </div>

          <p className="pack-hint font-mono-data">{WAIT_COPY[phase] ?? "Working…"}</p>

          {phase === "awaiting_randomness" && (
            <p className="text-white/40 text-[12.5px] max-w-[420px] text-center mt-3 leading-[1.5]">
              Nobody knows this outcome yet — not you, not us, not the node answering. Your payment is
              held on-chain until it does.
              {txHash && (
                <>
                  <br />
                  <span className="font-mono-data text-[11px] text-white/30">
                    {txHash.slice(0, 10)}…{txHash.slice(-8)}
                  </span>
                </>
              )}
            </p>
          )}
        </>
      )}

      {phase === "error" && (
        <div className="pack-reveal" style={{ "--glow": "#ff6b6b" }}>
          <div className="pack-meta">
            <span className="pack-badge rarity-ungraded">Not completed</span>
            <h3 className="pack-name font-sf-pro-rounded">{error?.message ?? "Something went wrong"}</h3>
            <p className="text-white/50 text-[13px] max-w-[440px] text-center leading-[1.55] mt-2">
              {error?.code === "jurisdiction_blocked" || error?.code === "kyc_required" ? (
                "Nothing was charged."
              ) : (
                <>
                  If you were already charged, your draw is still yours: it can be claimed or refunded
                  by anyone, at any time, without us.{" "}
                  <a className="link-underline text-white/80" href="/verify">
                    Recover it yourself →
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="pack-actions">
            <button className="pack-btn-secondary btn-anim" onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}

      {phase === "revealed" && (
        <div className="pack-reveal" style={{ "--glow": rarity.color }}>
          <div className="pack-reveal-halo" />
          {rarity.label === "Epic" && <div className="pack-rays" />}

          <div className="pack-card">
            <div className="pack-card-inner">
              <img
                src={card?.imageUrl ?? "/chari.png"}
                alt={card?.name ?? "Your card"}
                className="pack-card-img"
                draggable="false"
              />
              <div className="holo-sheen" />
            </div>
          </div>

          <div className="pack-meta">
            <span className={`pack-badge ${rarity.badge}`}>{card?.grade ?? rarity.rarity}</span>
            <h3 className="pack-name font-sf-pro-rounded">{card?.name ?? "Your card"}</h3>
            <div className="pack-value">
              <Image src="/coin.svg" alt="" width={22} height={22} className="mt-0.5" />
              <span className="tabular-nums">{formatUnits(card?.priceRef, 6)}</span>
            </div>
          </div>

          {/* The receipt: exactly which committed odds produced this card. */}
          <div className="font-mono-data text-[10.5px] text-white/35 text-center leading-[1.7] mt-1">
            <div>
              draw #{draw?.drawId} · weight {draw?.winningWeight} / {terms?.terms?.totalWeight}
            </div>
            <div>
              odds v{draw?.poolVersion} · root {String(terms?.terms?.merkleRoot ?? "").slice(0, 10)}…
            </div>
            <a className="link-underline text-white/55" href="/verify">
              verify this draw yourself →
            </a>
          </div>

          <div className="pack-actions">
            <button
              className="pack-btn-secondary btn-anim"
              disabled={keeping}
              onClick={async () => {
                // Keeping is a real action now — it delivers the card out of the vault rather than
                // just dismissing the dialog. Close either way: the draw belongs to the user and is
                // deliverable by anyone once the window passes, so a failed relay is not a dead end.
                setKeeping(true);
                try {
                  await onKeep?.(draw);
                } finally {
                  setKeeping(false);
                  close();
                }
              }}
            >
              {keeping ? "Delivering…" : "Keep it"}
            </button>
            {onSellBack && (
              <button
                className="pack-btn-primary buy-now-button"
                disabled={keeping}
                onClick={() => onSellBack(draw)}
              >
                <span className="buy-now-button-text">Sell back</span>
              </button>
            )}
          </div>
          <p className="text-white/35 text-[11.5px] text-center mt-3 leading-[1.6]">
            Keeping moves the card into your collection now. You can also do nothing — it is yours
            either way, and is delivered automatically once the sell-back window
            {windowLabel ? ` (${windowLabel})` : ""} closes.
          </p>
        </div>
      )}
    </div>
  );
}
