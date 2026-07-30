"use client";

import { useState } from "react";
import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";
import { api, formatUnits } from "@/app/lib/api";
import { useMarketplace } from "@/app/hooks/useMarketplace";
import Reveal from "@/app/components/Reveal";
import { rarityClass } from "@/app/components/Card";
import { Skeleton } from "@/app/components/Skeleton";

/**
 * A single card.
 *
 * Everything here is read from chain state or the indexer — the grading certificate committed at mint,
 * who holds it now, whether it has been redeemed, and its real trade history. The card's "insured
 * value" is the reference price committed in the pool it was drawn from, which is why it is labelled
 * as a committed figure rather than presented as a live market quote.
 */
export default function CardDetailsPage() {
  // App Router passes route params via useParams(), not as a prop — reading a `cardId` prop left it
  // undefined, so every card 404'd.
  const cardId = useParams()?.id;
  const searchParams = useSearchParams();
  const connectedChain = useChainId();
  const chainId = Number(searchParams.get("chainId") ?? connectedChain);
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const { buy, busy, error } = useMarketplace();
  const [notice, setNotice] = useState(null);

  const { data: card, isLoading } = useQuery({
    queryKey: ["card", chainId, cardId],
    queryFn: () => api.card(chainId, cardId),
    retry: false,
  });

  const isOwner = card?.owner && address && card.owner.toLowerCase() === address.toLowerCase();

  const onBuy = async () => {
    setNotice(null);
    try {
      await buy({
        id: card.listing.id,
        chainId,
        marketplace: card.listing.marketplace,
        paymentRouter: card.listing.paymentRouter,
        order: card.listing.order,
        signature: card.listing.signature,
        card: { name: card.name },
      });
      setNotice("Bought. The card is yours.");
      void queryClient.invalidateQueries({ queryKey: ["card", chainId, cardId] });
    } catch {
      /* surfaced via `error` */
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen pt-[120px] pb-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-10 items-start">
            <div className="holo-case relative rounded-[28px] p-6">
              <div className="aspect-[5/7] rounded-[18px] skeleton" />
            </div>
            <div className="space-y-5">
              <div>
                <Skeleton className="h-[22px] w-20 rounded-lg mb-3" />
                <Skeleton className="h-[34px] w-64 max-w-full mb-2.5" />
                <Skeleton className="h-[14px] w-40" />
              </div>
              <div className="glass rounded-2xl p-5 space-y-3">
                <Skeleton className="h-[11px] w-44" />
                <Skeleton className="h-[26px] w-28" />
                <Skeleton className="h-[12px] w-full max-w-[280px]" />
              </div>
              <div className="glass rounded-2xl p-5 space-y-2.5">
                <Skeleton className="h-[11px] w-36 mb-1.5" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[13px] w-full" />
                ))}
              </div>
              <Skeleton className="h-[56px] w-full rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="min-h-screen pt-[130px] px-6 max-w-[900px] mx-auto">
        <h1 className="text-white text-[26px] font-bold mb-2">Card not found</h1>
        <p className="text-white/50 text-[14px]">
          No card #{cardId} on this network.{" "}
          <a href="/marketplace" className="link-underline text-white/80">
            Browse the marketplace →
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-[120px] pb-24">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-10 items-start">
          <Reveal y={30}>
            <div className="holo-case relative rounded-[28px] p-6">
              <div className="relative aspect-[5/7] rounded-[18px] overflow-hidden flex items-center justify-center">
                <img
                  src={card.imageUrl}
                  alt={card.name}
                  draggable="false"
                  className="relative z-[1] w-full h-full object-contain"
                />
                <div className="holo-sheen" />
              </div>
            </div>
          </Reveal>

          <div className="space-y-5">
            <Reveal y={26} delay={80}>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className={`${rarityClass(card.grading.grade)} inline-flex items-center px-2.5 py-0.5 rounded-lg text-[13px] font-bold`}
                  >
                    {card.grading.grade}
                  </span>
                  {card.redeemed && (
                    <span className="rarity-ungraded inline-flex items-center px-2.5 py-0.5 rounded-lg text-white/70 text-[13px] font-bold">
                      Redeemed &amp; shipped
                    </span>
                  )}
                  {card.inVault && (
                    <span className="rarity-b inline-flex items-center px-2.5 py-0.5 rounded-lg text-[#6B8AFF] text-[13px] font-bold">
                      In vault
                    </span>
                  )}
                </div>
                <h1 className="font-sf-pro-rounded text-white text-[28px] md:text-[34px] font-bold tracking-[-0.02em] leading-[1.1]">
                  {card.name}
                </h1>
                <p className="text-white/45 text-[14px] mt-1.5">
                  {card.setName ?? "—"}
                  {card.year ? ` · ${card.year}` : ""} · #{card.tokenId}
                </p>
              </div>
            </Reveal>

            <Reveal y={22} delay={140}>
              <div className="glass rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono-data text-[10.5px] tracking-[0.2em] uppercase text-white/40">
                    Committed reference value
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Image src="/coin.svg" alt="" width={24} height={24} className="mt-0.5" />
                  <span className="text-white text-[26px] font-bold tabular-nums">
                    {card.insuredValue ? formatUnits(card.insuredValue, 6) : "—"}
                  </span>
                </div>
                <p className="text-white/35 text-[12px] leading-[1.5]">
                  The price committed on-chain when this card entered its pack. It caps any sell-back
                  offer; it is not a live market quote.
                </p>
              </div>
            </Reveal>

            <Reveal y={22} delay={200}>
              <div className="glass rounded-2xl p-5">
                <p className="font-mono-data text-[10.5px] tracking-[0.2em] uppercase text-white/40 mb-3">
                  Grading &amp; authenticity
                </p>
                <dl className="space-y-2 text-[13.5px]">
                  {[
                    ["Grader", card.grading.company],
                    ["Grade", card.grading.grade],
                    ["Certificate", card.grading.certNumber],
                    ["Owner", card.redeemed ? "burned on redemption" : (card.owner ?? "—")],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="text-white/45">{k}</dt>
                      <dd className="text-white/85 font-mono-data text-[12px] break-all text-right">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-white/30 text-[11.5px] mt-3 leading-[1.5] break-all">
                  On-chain commitment {card.grading.commitment.slice(0, 22)}… binds this certificate to
                  this token permanently — one card, one token, forever.
                </p>
              </div>
            </Reveal>

            {(notice || error) && (
              <div className={`glass rounded-xl px-4 py-3 text-[13.5px] ${error ? "text-[#ff6b6b]" : "text-[#2BD383]"}`}>
                {error ?? notice}
              </div>
            )}

            <Reveal y={22} delay={260}>
              {card.listing && !isOwner ? (
                <button
                  onClick={onBuy}
                  disabled={!isConnected || busy === `buy:${card.listing.id}`}
                  className="holo-cta relative w-full rounded-2xl py-4 font-semibold text-[15px] text-white disabled:opacity-50"
                >
                  <span className="relative z-[1]">
                    {busy === `buy:${card.listing.id}`
                      ? "Confirm in wallet…"
                      : !isConnected
                        ? "Connect wallet to buy"
                        : `Buy for $${formatUnits(card.listing.price, 6)}`}
                  </span>
                </button>
              ) : card.listing && isOwner ? (
                <p className="glass rounded-2xl p-4 text-white/60 text-[13.5px] text-center">
                  You own this card and it is listed for ${formatUnits(card.listing.price, 6)}.
                </p>
              ) : (
                <p className="glass rounded-2xl p-4 text-white/50 text-[13.5px] text-center">
                  {card.inVault
                    ? "This card is in the vault and can be pulled from a pack."
                    : "Not currently for sale."}
                </p>
              )}
            </Reveal>

            <Reveal y={22} delay={320}>
              <div className="glass rounded-2xl p-5">
                <p className="font-mono-data text-[10.5px] tracking-[0.2em] uppercase text-white/40 mb-3">
                  Trade history
                </p>
                {card.history.length === 0 ? (
                  <p className="text-white/35 text-[13px]">No sales yet.</p>
                ) : (
                  <div className="space-y-2.5">
                    {card.history.map((h) => (
                      <div key={h.txHash} className="flex items-center justify-between text-[13px]">
                        <span className="text-white/55 font-mono-data text-[11.5px]">
                          {h.seller.slice(0, 8)}… → {h.buyer.slice(0, 8)}…
                        </span>
                        <span className="text-white/85 tabular-nums">
                          ${formatUnits(h.price, 6)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}
