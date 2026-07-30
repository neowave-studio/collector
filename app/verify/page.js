"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatUnits } from "../lib/api";
import { RowSkeleton } from "../components/Skeleton";

/**
 * A per-pack disclosure that fetches the published pool file's real locations on demand, so anyone can
 * download the exact committed file and rebuild the Merkle root themselves (spec §8.2).
 */
function PoolFileDisclosure({ pack }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["poolFile", pack.chainId, pack.packId, pack.poolVersion],
    queryFn: () => api.poolFile(pack.chainId, pack.packId, pack.poolVersion),
    enabled: open,
    retry: false,
  });

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="link-underline text-white/55 hover:text-white text-[12.5px]"
      >
        {open ? "Hide the published pool file" : "Get the published pool file →"}
      </button>
      {open && (
        <div className="mt-2 glass rounded-lg p-3">
          {isLoading && <p className="text-white/40 text-[12px]">Reading…</p>}
          {data && (
            <>
              <p className="font-mono-data text-[10px] tracking-[0.2em] uppercase text-white/35 mb-2">
                Download the exact file
              </p>
              <div className="flex flex-wrap gap-2 mb-2.5">
                {data.gateways.map((g) => (
                  <a
                    key={g}
                    href={g}
                    target="_blank"
                    rel="noreferrer"
                    className="glass-soft rounded-lg px-3 py-1.5 text-[12px] text-white/75 hover:text-white border border-[#FFFFFF1A]"
                  >
                    {(() => {
                      try {
                        return new URL(g).hostname;
                      } catch {
                        return g;
                      }
                    })()}{" "}
                    →
                  </a>
                ))}
              </div>
              <p className="text-white/40 text-[11.5px] leading-[1.55]">{data.note}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The trust page: live proof of reserves, the committed odds, and the escape hatches spelled out.
 *
 * This exists because "provably fair and solvent" is only a claim until a user can check it without
 * asking us. Everything here points at something verifiable on-chain, or at a tool that runs with no
 * network at all.
 */
export default function VerifyPage() {
  const { data: reserves, isLoading } = useQuery({ queryKey: ["reserves"], queryFn: api.reserves });
  const { data: packs } = useQuery({ queryKey: ["packs"], queryFn: api.packs });

  return (
    <main className="min-h-screen pt-[130px] pb-24 lg:px-8 md:px-6 px-4">
      <div className="max-w-[900px] mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="iri-divider w-8" />
            <span className="font-mono-data text-[11px] tracking-[0.35em] uppercase iri-text">
              Check our work
            </span>
          </div>
          <h1 className="font-sf-pro-rounded text-white text-[30px] md:text-[38px] font-bold tracking-[-0.02em]">
            Don&apos;t trust us. Verify.
          </h1>
          <p className="text-white/55 text-[15px] leading-[1.6] mt-3 max-w-[640px]">
            Three things here are meant to be checkable rather than promised: the odds you were shown
            were fixed before you bought, the sell-back you were offered is funded, and your card is
            yours to take even if we vanish. Here is how to confirm each one.
          </p>
        </div>

        {/* --- solvency ---------------------------------------------------------------------- */}
        <section className="glass rounded-2xl p-6">
          <h2 className="text-white font-semibold text-[17px] mb-1">Proof of reserves</h2>
          <p className="text-white/50 text-[13.5px] leading-[1.55] mb-5">
            Every sell-back we offer is booked as an on-chain liability the moment your draw is
            revealed — before you are ever told a sell-back exists. The reserve cannot pay out more
            than it holds, and we can only withdraw what sits above those obligations, after a public
            48-hour delay.
          </p>

          {isLoading && <RowSkeleton count={2} />}

          <div className="space-y-3">
            {reserves?.map((r) => (
              <div
                key={`${r.chainId}-${r.token}`}
                className="glass-soft rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div>
                  <p className="text-white font-semibold text-[14px]">
                    {r.chain} · {r.symbol}
                  </p>
                  <p className="font-mono-data text-[11px] text-white/35 mt-0.5">
                    held {formatUnits(r.balance, 6)} · owed {formatUnits(r.reservedLiabilities, 6)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[12px] font-bold px-2.5 py-1 rounded-lg ${
                      r.solvent ? "rarity-s text-[#2BD383]" : "rarity-ungraded text-[#ff6b6b]"
                    }`}
                  >
                    {r.solvent ? "FULLY BACKED" : "UNDERFUNDED"}
                  </span>
                  {r.buybackPaused && (
                    <span className="text-[12px] font-bold px-2.5 py-1 rounded-lg rarity-a text-[#FFD36B]">
                      SELL-BACK PAUSED
                    </span>
                  )}
                  {r.explorer && (
                    <a
                      className="link-underline text-white/50 hover:text-white text-[12.5px]"
                      href={r.explorer}
                      target="_blank"
                      rel="noreferrer"
                    >
                      on-chain →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* --- odds -------------------------------------------------------------------------- */}
        <section className="glass rounded-2xl p-6">
          <h2 className="text-white font-semibold text-[17px] mb-1">The committed odds</h2>
          <p className="text-white/50 text-[13.5px] leading-[1.55] mb-5">
            The contract builds each pack&apos;s Merkle root itself, from a list it has verified covers
            every outcome exactly once — no gaps, no overlaps, no card listed twice. A committed
            version is write-once, so odds cannot be edited after you buy, and a version switch is
            announced blocks in advance so it can never be slipped in around your purchase.
          </p>

          <div className="space-y-3">
            {!packs && <RowSkeleton count={1} />}
            {packs?.map((pack) => (
              <div key={`${pack.chainId}-${pack.packId}`} className="glass-soft rounded-xl p-4">
                <p className="text-white font-semibold text-[14px] mb-1.5">
                  {pack.name} · v{pack.poolVersion}
                </p>
                <div className="font-mono-data text-[11px] text-white/35 space-y-1 break-all">
                  <div>root: {pack.merkleRoot}</div>
                  <div>pool file: {pack.poolCid}</div>
                  <div>
                    {pack.cardCount} cards · total weight {pack.totalWeight}
                  </div>
                </div>
                <PoolFileDisclosure pack={pack} />
              </div>
            ))}
          </div>
        </section>

        {/* --- escape hatches ---------------------------------------------------------------- */}
        <section className="glass rounded-2xl p-6">
          <h2 className="text-white font-semibold text-[17px] mb-1">If we disappear</h2>
          <p className="text-white/50 text-[13.5px] leading-[1.55] mb-4">
            Nothing about claiming your card depends on this website, our servers, or our permission.
            These paths are permissionless and cannot be paused by us:
          </p>
          <ul className="text-white/60 text-[13.5px] leading-[1.7] space-y-2 list-disc pl-5">
            <li>
              <span className="text-white">claimAfterTimeout</span> — once the sell-back window passes,
              anyone can deliver a revealed draw. The card goes to whoever owns the draw, never to
              whoever sends the transaction.
            </li>
            <li>
              <span className="text-white">refundStuckRip</span> — if randomness never arrives, the
              escrowed payment goes back to the buyer.
            </li>
            <li>
              <span className="text-white">claimUnavailable</span> — if your card was already won by an
              earlier draw, you are paid its committed reference value from the reserve.
            </li>
          </ul>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="/tools/proof-generator/index.html"
              className="glass-soft rounded-xl px-4 py-3 text-[13.5px] font-semibold text-white/85 hover:text-white border border-[#FFFFFF1A]"
            >
              Open the offline verifier
            </a>
            <a
              href="https://github.com/neowave-studio/collector/tree/main/tools/proof-generator"
              target="_blank"
              rel="noreferrer"
              className="glass-soft rounded-xl px-4 py-3 text-[13.5px] font-semibold text-white/85 hover:text-white border border-[#FFFFFF1A]"
            >
              Read its source
            </a>
          </div>
          <p className="text-white/35 text-[12.5px] mt-3 leading-[1.55]">
            The verifier has no dependencies and makes no network requests. Save it to a USB stick and
            it still builds a valid transaction years from now.
          </p>
        </section>

        {/* --- honesty ----------------------------------------------------------------------- */}
        <section className="glass rounded-2xl p-6">
          <h2 className="text-white font-semibold text-[17px] mb-1">What still requires trust</h2>
          <p className="text-white/50 text-[13.5px] leading-[1.55]">
            Being specific about the limits is part of the claim. Shipping a physical card after you
            redeem is an off-chain promise. A mis-minted card can be recovered by an admin, but only
            through a public 48-hour delay and never while a draw on that pack is unresolved. And the
            sell-back price within the on-chain cap is chosen by us — capped, windowed, rate-limited
            and reserve-backed, but ours.
          </p>
        </section>
      </div>
    </main>
  );
}
