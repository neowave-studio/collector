"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

// Weighted by the pack's advertised pull odds.
const TIERS = [
  { key: "common", chance: 80, rarity: "Ungraded", badge: "rarity-ungraded", color: "#8A8F98", value: "48.00" },
  { key: "uncommon", chance: 15, rarity: "B", badge: "rarity-b", color: "#6B8AFF", value: "96.00" },
  { key: "rare", chance: 4, rarity: "A+", badge: "rarity-a", color: "#FFD36B", value: "184.00" },
  { key: "epic", chance: 1, rarity: "S+", badge: "rarity-s", color: "#2BD383", value: "1,920.00" },
];

const NAMES = [
  "Charizard Holo Rare",
  "Mewtwo Holo Rare",
  "Pikachu Holo Rare",
  "Lugia Holo Rare",
  "Blastoise Holo Rare",
];

function pickPrize() {
  const roll = Math.random() * 100;
  let acc = 0;
  let tier = TIERS[0];
  for (const t of TIERS) {
    acc += t.chance;
    if (roll <= acc) {
      tier = t;
      break;
    }
  }
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  return { ...tier, name, image: "/chari.png" };
}

export default function PackOpenModal({ open, onClose }) {
  const [phase, setPhase] = useState("idle"); // idle | charging | burst | reveal
  const [prize, setPrize] = useState(null);
  const timers = useRef([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const run = useCallback(() => {
    clearTimers();
    setPrize(pickPrize());
    setPhase("charging");
    timers.current.push(setTimeout(() => setPhase("burst"), 1600));
    timers.current.push(setTimeout(() => setPhase("reveal"), 2150));
  }, []);

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      run();
      return () => {
        clearTimers();
        document.body.style.overflow = prev;
      };
    }
    setPhase("idle");
    return clearTimers;
  }, [open, run]);

  if (!open && phase === "idle") return null;

  return (
    <div className="pack-overlay" role="dialog" aria-modal="true" aria-label="Opening pack">
      <button className="pack-close" onClick={onClose} aria-label="Close">
        ✕
      </button>

      {(phase === "charging" || phase === "burst") && (
        <div className={`pack-machine ${phase}`}>
          <div className="pack-aura" />
          <img
            src="/productimage.png"
            alt="Elite Pokémon Gacha Pack"
            className="pack-img"
            draggable="false"
          />
          <div className="holo-sheen" />
        </div>
      )}

      {phase === "charging" && (
        <p className="pack-hint font-mono-data">Charging pack…</p>
      )}

      {phase === "burst" && <div className="pack-flash" />}

      {phase === "reveal" && prize && (
        <div className="pack-reveal" style={{ "--glow": prize.color }}>
          <div className="pack-reveal-halo" />
          {prize.key === "epic" && <div className="pack-rays" />}

          <div className="pack-card">
            <div className="pack-card-inner">
              <img
                src={prize.image}
                alt={prize.name}
                className="pack-card-img"
                draggable="false"
              />
              <div className="holo-sheen" />
            </div>
          </div>

          <div className="pack-meta">
            <span className={`pack-badge ${prize.badge}`}>{prize.rarity}</span>
            <h3 className="pack-name font-sf-pro-rounded">{prize.name}</h3>
            <div className="pack-value">
              <Image src="/coin.svg" alt="" width={22} height={22} className="mt-0.5" />
              <span className="tabular-nums">{prize.value}</span>
            </div>
          </div>

          <div className="pack-actions">
            <button className="pack-btn-secondary btn-anim" onClick={onClose}>
              Collect
            </button>
            <button className="pack-btn-primary buy-now-button" onClick={run}>
              <span className="buy-now-button-text">Open another</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
