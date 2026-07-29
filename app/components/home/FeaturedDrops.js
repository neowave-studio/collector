"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { api, formatUnits } from "../../lib/api";
import Reveal from "../Reveal";

/**
 * Cards currently for sale, straight from the order book.
 *
 * Deliberately shows real listings rather than a curated highlight reel: a "featured" strip of cards
 * nobody can actually buy is just decoration, and next to a live marketplace it reads as fake.
 */
export default function FeaturedDrops() {
  const chainId = useChainId();
  const { data: listings, isLoading } = useQuery({
    queryKey: ["listings", chainId, "featured"],
    queryFn: () => api.listings({ chainId, limit: 8 }),
    refetchInterval: 30_000,
  });

  const hasAny = listings && listings.length > 0;

  return (
    <section className="relative lg:px-8 md:px-6 px-4 pb-24">
      <div className="max-w-[1300px] mx-auto">
        <Reveal y={24}>
          <div className="flex items-end justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="iri-divider w-8" />
                <span className="font-mono-data text-[10px] md:text-[11px] tracking-[0.35em] uppercase iri-text">
                  On the market
                </span>
              </div>
              <h2 className="font-sf-pro-rounded text-white text-[26px] md:text-[32px] font-bold tracking-[-0.02em]">
                Listed by collectors
              </h2>
            </div>
            <a
              href="/marketplace"
              className="link-underline hidden sm:inline-flex items-center gap-2 text-white/55 hover:text-white text-[14px] font-medium pb-1"
            >
              Browse marketplace
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </Reveal>

        {isLoading && <p className="text-white/40 text-[14px]">Loading listings…</p>}

        {!isLoading && !hasAny && (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="text-white/60 text-[15px] mb-1">Nothing listed right now.</p>
            <p className="text-white/35 text-[13.5px]">
              Cards appear here the moment a collector lists one.
            </p>
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {listings?.map((listing) => (
            <a
              key={listing.id}
              href={`/card/${listing.order.tokenId}?chainId=${listing.chainId}`}
              className="group bg-[#101010] rounded-[12px] overflow-hidden border border-[#FFFFFF1A] hover:border-[#2BD383]/40 hover:-translate-y-1.5 transition-all duration-300"
            >
              <div className="relative">
                <div className="absolute top-3 right-3 rounded-lg px-3 text-[#FFFFFF99] font-[700] text-[13px] border z-10 rarity-a">
                  {listing.card.grade}
                </div>
                <div className="flex items-center justify-center px-10 pt-10">
                  <div className="w-full aspect-[5/7] overflow-hidden rounded-lg">
                    <img
                      src={listing.card.imageUrl}
                      alt={listing.card.name}
                      className="w-full h-full object-contain rounded-lg transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 pb-4">
                <h3 className="text-white font-bold text-[17px] truncate">{listing.card.name}</h3>
                <p className="text-white/45 text-[12.5px] mb-2 truncate">
                  {listing.card.setName ?? "—"}
                </p>
                <div className="flex items-center gap-2">
                  <Image src="/coin.svg" alt="" width={20} height={20} className="mt-0.5" />
                  <span className="text-white font-bold text-[16px] tabular-nums">
                    {formatUnits(listing.order.price, 6)}
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
