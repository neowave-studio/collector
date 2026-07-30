"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import Reveal from "../Reveal";
import OddsDisclosure from "../OddsDisclosure";
import MoonPayButton from "../MoonPayButton";
import { formatUnits } from "../../lib/api";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * @param {object} props
 * @param {() => void} [props.onOpen]   Starts the rip flow.
 * @param {object}     [props.pack]     Live pack from the backend, including its committed odds.
 * @param {boolean}    [props.disabled] True when the user cannot buy (not signed in, not verified,
 *                                      or on a marketplace-only chain).
 * @param {string}     [props.blockedReason] Why, shown verbatim so a refusal is never mysterious.
 * @param {number}     [props.chainId]
 */
export default function HomeHero({ onOpen, pack, disabled, blockedReason, chainId, action }) {
  const caseRef = useRef(null);

  // Derived from the committed pool, never hardcoded: a "big win" is any card whose reference value
  // exceeds the pack price, which is a fact about the odds rather than a marketing number.
  const stats = pack
    ? [
        {k: "Pack content", v: "1 card"},
        {k: "Sell-back", v: `${(pack.buybackBps / 100).toFixed(0)}%`},
        {
          k: "Above pack price",
          v: `${(
            (pack.odds ?? [])
              .filter((o) => BigInt(o.priceRef) > BigInt(pack.pricePerRip))
              .reduce((sum, o) => sum + o.probability, 0) * 100
          ).toFixed(1)}%`,
        },
      ]
    : [
        {k: "Pack content", v: "1 card"},
        {k: "Sell-back", v: "—"},
        {k: "Above pack price", v: "—"},
      ];

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
                    src={pack?.imageUrl ?? "/productimage.png"}
                    alt={pack?.name ?? "Gacha pack"}
                    draggable="false"
                    className="relative z-[1] w-full h-full object-contain drop-shadow-[0_24px_44px_rgba(0,0,0,0.55)]"
                  />
                  <div className="holo-sheen" />
                </div>
              </div>

              {/* The live pack. One entry because one pool is active; more appear as they are committed. */}
              {pack && (
                <div className="flex gap-3 mt-6">
                  <div className="nav-active flex-1 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[13px] md:text-[15px] font-semibold text-white">
                    <span className="rounded-xl p-2.5 bg-white/[0.12] border border-white/20">
                      <img
                        src={pack.imageUrl ?? "/productimage.png"}
                        className="w-6 h-6 md:w-8 md:h-8 object-contain"
                        alt=""
                      />
                    </span>
                    {pack.name}
                  </div>
                </div>
              )}
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
                      {pack?.name ?? "Gacha Pack"}
                    </h1>
                  </div>
                  <div className="text-left sm:text-right shrink-0">
                    <p className="font-mono-data text-[10px] tracking-[0.25em] uppercase text-white/40 mb-1.5">
                      Price per pack
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
                        {pack ? formatUnits(pack.pricePerRip, 6) : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>

            {/* Quick stats */}
            <Reveal y={24} delay={260}>
              <div className="grid grid-cols-3 gap-3">
                {stats.map((s) => (
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

            {/* Pull odds — committed on-chain, disclosed at the point of purchase (spec §12) */}
            <Reveal y={24} delay={340}>
              {/*
                No pack means no odds — say so, rather than showing a plausible-looking table.
                This slot used to render four invented tiers ("Common $30–$60", 80%…) behind an
                "indicative only" caption. Nothing in them came from the committed pool, and odds are
                the one number this product exists to make verifiable: publishing a made-up version
                while the real one is one request away is the worst possible placeholder. An empty
                state costs a reader nothing; a fabricated one costs them their trust.
              */}
              {pack ? (
                <OddsDisclosure pack={pack} />
              ) : (
                <div className="glass rounded-2xl p-5">
                  <span className="font-mono-data text-[11px] tracking-[0.25em] uppercase text-white/50">
                    Pull odds
                  </span>
                  <p className="text-white/45 text-[13px] mt-3 leading-[1.6]">
                    Loaded from the pool committed on-chain, so there is nothing to show until a pack is
                    active on this network. Connect a wallet, or switch to a network that has one.
                  </p>
                </div>
              )}
            </Reveal>

            {/* Where the reserve stands, read live from chain — this is the claim worth surfacing. */}
            <Reveal y={24} delay={420}>
              <div className="glass rounded-2xl p-5">
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="text-white font-semibold text-[15px]">Sell-back is funded</h3>
                  <a href="/verify" className="link-underline text-white/45 hover:text-white text-[12.5px]">
                    proof of reserves →
                  </a>
                </div>
                <p className="text-white/50 text-[12.5px] leading-[1.55]">
                  {pack
                    ? `Pull a card and you can keep it, have the physical card shipped, sell it to another collector, or sell it back to us for up to ${(pack.buybackBps / 100).toFixed(0)}% of its committed reference value. That money is set aside on-chain the moment your draw is revealed.`
                    : "Every sell-back offer is backed by funds set aside on-chain before you are ever offered one."}
                </p>
              </div>
            </Reveal>

            {/* CTA */}
            <Reveal y={22} delay={500}>
              <div className="space-y-3">
                {/*
                  A blocker the user can clear themselves gets a working button, not a greyed-out
                  one. "Unavailable" next to "Sign in to continue" states a problem and then removes
                  the means to fix it, which reads as broken rather than as a prompt.
                */}
                <button
                  onClick={action?.onClick ?? onOpen}
                  disabled={(disabled && !action) || (!onOpen && !action)}
                  className="holo-cta relative w-full rounded-2xl py-4 font-semibold text-[15px] text-white flex items-center justify-center gap-2 overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="relative z-[1]">
                    {action ? action.label : disabled ? "Unavailable" : "Open Pack"}
                  </span>
                  {!disabled && !action && (
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
                  )}
                </button>

                {blockedReason && (
                  <p className="text-white/45 text-[12.5px] leading-[1.55] text-center">
                    {blockedReason}
                  </p>
                )}

                {chainId ? <MoonPayButton chainId={chainId} /> : null}
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
