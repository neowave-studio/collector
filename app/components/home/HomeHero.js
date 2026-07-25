"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import Reveal from "../Reveal";

const RARITIES = [
  { label: "Common", range: "$30 – $60", chance: "80%", dot: "#8A8F98" },
  { label: "Uncommon", range: "$60 – $110", chance: "15%", dot: "#6B8AFF" },
  { label: "Rare", range: "$110 – $250", chance: "4%", dot: "#FFD36B" },
  { label: "Epic", range: "$250 – $2,000+", chance: "1%", dot: "#2BD383" },
];

const PACKS = [
  { id: "PKMN 50", label: "PKMN 50" },
  { id: "PKMN 250", label: "PKMN 250" },
];

const QUICK_STATS = [
  { k: "Pack Content", v: "1 Card" },
  { k: "Instant Buyback", v: "85%" },
  { k: "Big Win Chance", v: "20%" },
];

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function HomeHero({ onOpen }) {
  const [turbo, setTurbo] = useState(false);
  const [selectedPack, setSelectedPack] = useState("PKMN 50");
  const caseRef = useRef(null);

  const handleMove = useCallback((e) => {
    const el = caseRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${px * 100}%`);
    el.style.setProperty("--my", `${py * 100}%`);
    if (!prefersReducedMotion()) {
      el.style.setProperty("--rx", `${(py - 0.5) * -7}deg`);
      el.style.setProperty("--ry", `${(px - 0.5) * 9}deg`);
    }
  }, []);

  const handleLeave = useCallback(() => {
    const el = caseRef.current;
    if (!el) return;
    el.style.setProperty("--mx", "50%");
    el.style.setProperty("--my", "38%");
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }, []);

  return (
    <section className="relative pt-[116px] md:pt-[150px] lg:pt-[190px] pb-16 lg:px-8 md:px-6 px-4">
      <div className="max-w-[1300px] mx-auto">
        {/* Trust eyebrow */}
        <Reveal y={16} delay={40}>
          <div className="flex items-center justify-center gap-3 mb-10 md:mb-14">
            <span className="iri-divider w-8 md:w-12 hidden sm:block" />
            <span className="font-mono-data text-[10px] md:text-[11px] tracking-[0.3em] uppercase text-white/45 text-center">
              Provably fair · Graded &amp; authenticated · Instant buyback
            </span>
            <span className="iri-divider w-8 md:w-12 hidden sm:block" />
          </div>
        </Reveal>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)] grid-cols-1 gap-8 lg:gap-14 items-center">
          {/* LEFT — holographic display case */}
          <Reveal y={40} delay={120}>
            <div className="relative">
              <div
                ref={caseRef}
                onMouseMove={handleMove}
                onMouseLeave={handleLeave}
                className="holo-case relative rounded-[28px] p-5 md:p-7"
                style={{
                  transform:
                    "perspective(1100px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))",
                }}
              >
                <div className="relative aspect-square rounded-[18px] overflow-hidden flex items-center justify-center">
                  <img
                    src="/productimage.png"
                    alt="Elite Pokémon Gacha Pack"
                    draggable="false"
                    className="relative z-[1] w-full h-full object-contain drop-shadow-[0_24px_44px_rgba(0,0,0,0.55)]"
                  />
                  <div className="holo-sheen" />
                </div>
              </div>

              {/* Pack selector */}
              <div className="flex gap-3 mt-6">
                {PACKS.map((p) => {
                  const active = selectedPack === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPack(p.id)}
                      className={`btn-anim flex-1 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[13px] md:text-[15px] font-semibold ${
                        active
                          ? "nav-active text-white"
                          : "glass-soft text-white/50 hover:text-white/85"
                      }`}
                    >
                      <span
                        className={`rounded-xl p-2.5 ${
                          active
                            ? "bg-white/[0.12] border border-white/20"
                            : "bg-white/[0.06] border border-transparent"
                        }`}
                      >
                        <img
                          src="/productimage.png"
                          className="w-6 h-6 md:w-8 md:h-8 object-contain"
                          alt=""
                        />
                      </span>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Reveal>

          {/* RIGHT — details */}
          <div className="space-y-5 md:space-y-6">
            {/* Header */}
            <Reveal y={26} delay={180}>
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="font-mono-data text-[10px] md:text-[11px] tracking-[0.4em] uppercase iri-text">
                    Featured pack
                  </span>
                  <span className="iri-divider flex-1 max-w-[120px]" />
                </div>
                <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="rarity-a inline-flex items-center px-2.5 py-0.5 rounded-lg text-[#FFCA61] text-[12px] md:text-[13px] font-bold">
                        A+
                      </span>
                      <span className="text-white/55 text-[13px] font-medium">
                        Guaranteed Authenticity
                      </span>
                    </div>
                    <h1 className="font-sf-pro-rounded text-white text-[30px] md:text-[38px] leading-[1.04] font-bold tracking-[-0.02em]">
                      Elite Pokémon
                      <br />
                      Gacha Pack
                    </h1>
                  </div>
                  <div className="text-left sm:text-right shrink-0">
                    <p className="font-mono-data text-[10px] tracking-[0.25em] uppercase text-white/40 mb-1.5">
                      Expected value
                    </p>
                    <div className="flex items-center gap-2 sm:justify-end">
                      <Image
                        src="/coin.svg"
                        alt=""
                        width={22}
                        height={22}
                        className="mt-0.5"
                      />
                      <span className="text-white text-[26px] md:text-[30px] font-bold tracking-tight tabular-nums">
                        2,600
                        <span className="text-white/40 text-[18px]">.00</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>

            {/* Quick stats */}
            <Reveal y={24} delay={260}>
              <div className="grid grid-cols-3 gap-3">
                {QUICK_STATS.map((s) => (
                  <div
                    key={s.k}
                    className="glass iri-top relative rounded-2xl px-4 py-3.5 overflow-hidden"
                  >
                    <p className="font-mono-data text-[9.5px] md:text-[10px] tracking-[0.12em] uppercase text-white/40 mb-1.5">
                      {s.k}
                    </p>
                    <p className="text-white text-[17px] md:text-[19px] font-semibold tabular-nums">
                      {s.v}
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>

            {/* Pull odds */}
            <Reveal y={24} delay={340}>
              <div className="glass rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-mono-data text-[11px] tracking-[0.25em] uppercase text-white/50">
                    Pull odds
                  </span>
                  <span className="font-mono-data text-[11px] text-white/30">
                    per card
                  </span>
                </div>
                <div className="flex h-2.5 rounded-full overflow-hidden mb-5 bg-white/[0.06]">
                  <div style={{ width: "80%", background: "#4b5158" }} />
                  <div style={{ width: "15%", background: "#6B8AFF" }} />
                  <div style={{ width: "4%", background: "#FFD36B" }} />
                  <div
                    style={{
                      width: "1%",
                      background: "linear-gradient(90deg,#2BD383,#A3FFD3)",
                    }}
                  />
                </div>
                <div className="space-y-2.5">
                  {RARITIES.map((r) => (
                    <div
                      key={r.label}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{
                            background: r.dot,
                            boxShadow: `0 0 8px ${r.dot}66`,
                          }}
                        />
                        <span className="text-white/85 text-[13px] md:text-[14px] font-medium">
                          {r.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-white/40 text-[12px] md:text-[13px] tabular-nums">
                          {r.range}
                        </span>
                        <span className="text-white/70 text-[12px] md:text-[13px] font-semibold tabular-nums w-9 text-right">
                          {r.chance}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            {/* Turbo + Free packs */}
            <Reveal y={24} delay={420}>
              <div className="grid md:grid-cols-[1fr_auto] gap-3">
                <div className="glass rounded-2xl p-5 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-white font-semibold text-[15px] mb-1">
                      Turbo Mode
                    </h3>
                    <p className="text-white/50 text-[12.5px] leading-[1.5] max-w-[320px]">
                      Auto-sells common cards and hunts grails at maximum speed.
                    </p>
                  </div>
                  <button
                    onClick={() => setTurbo(!turbo)}
                    aria-pressed={turbo}
                    className={`flex items-center w-[54px] h-[30px] rounded-full shrink-0 transition-colors ${
                      turbo ? "justify-end" : "justify-start"
                    }`}
                    style={{
                      padding: "3px",
                      background: turbo
                        ? "linear-gradient(180deg,#2BD383,#A3FFD3)"
                        : "rgba(255,255,255,0.1)",
                    }}
                  >
                    <span className="w-6 h-6 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.4)]" />
                  </button>
                </div>
                <div className="glass rounded-2xl p-5 md:w-[170px] flex flex-col justify-center">
                  <p className="font-mono-data text-[10px] tracking-[0.12em] uppercase text-white/40 mb-1">
                    Free Packs
                  </p>
                  <p className="text-white text-[20px] font-semibold">—</p>
                </div>
              </div>
            </Reveal>

            {/* CTA */}
            <Reveal y={22} delay={500}>
              {onOpen ? (
                <button
                  onClick={onOpen}
                  className="holo-cta relative w-full rounded-2xl py-4 font-semibold text-[15px] text-white flex items-center justify-center gap-2 overflow-hidden"
                >
                  <span className="relative z-[1]">Open Pack</span>
                  <svg
                    className="relative z-[1]"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2L12 2z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              ) : (
                <button className="holo-cta relative w-full rounded-2xl py-4 font-semibold text-[15px] text-white/90 flex items-center justify-center gap-2 overflow-hidden">
                  <span className="relative z-[1]">Sign in to open</span>
                  <Image
                    src="/whitelock.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="relative z-[1] opacity-80"
                  />
                </button>
              )}
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
