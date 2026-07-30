"use client";

import { useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { api, formatUnits } from "@/app/lib/api";
import Reveal from "@/app/components/Reveal";
import Card from "@/app/components/Card";
import { Skeleton, CardGridSkeleton } from "@/app/components/Skeleton";

/**
 * A public profile.
 *
 * Everything is derived from chain state: cards actually held by this address, draws it has made, and
 * trades it has settled. "Reference value" is the sum of committed reference prices and is labelled as
 * such — presenting it as a portfolio valuation would imply a market quote we do not have.
 */
export default function UserProfilePage() {
  // App Router passes the route param via useParams(), not as a prop — reading a `userId` prop left it
  // undefined, so the query stayed disabled and every profile fell through to "unavailable".
  const userId = useParams()?.id;
  const { address } = useAccount();
  const [tab, setTab] = useState("cards");

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => api.user(userId),
    retry: false,
    enabled: Boolean(userId),
  });

  const isMe = address && userId && address.toLowerCase() === userId.toLowerCase();

  if (isLoading) {
    return (
      <div className="min-h-screen pt-[120px] pb-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="glass rounded-2xl p-6 mb-8">
            <Skeleton className="h-[11px] w-24 mb-3" />
            <Skeleton className="h-[28px] w-72 max-w-full mb-2.5" />
            <Skeleton className="h-[12px] w-56 max-w-full" />
          </div>
          <div className="flex gap-2 mb-6">
            <Skeleton className="h-[36px] w-24 rounded-xl" />
            <Skeleton className="h-[36px] w-24 rounded-xl" />
            <Skeleton className="h-[36px] w-24 rounded-xl" />
          </div>
          <CardGridSkeleton count={3} />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen pt-[130px] px-6 max-w-[900px] mx-auto">
        <h1 className="text-white text-[26px] font-bold mb-2">Profile unavailable</h1>
        <p className="text-white/50 text-[14px]">That address has no activity on this network.</p>
      </div>
    );
  }

  const tabs = [
    ["cards", `Cards (${profile.cards.length})`],
    ["draws", `Packs (${profile.draws.length})`],
    ["trades", `Trades (${profile.trades.length})`],
  ];

  return (
    <div className="min-h-screen pt-[120px] pb-24">
      <div className="max-w-[1200px] mx-auto px-6">
        <Reveal y={26}>
          <div className="glass rounded-2xl p-6 mb-8">
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="iri-divider w-8" />
                  <span className="font-mono-data text-[10.5px] tracking-[0.25em] uppercase iri-text">
                    {isMe ? "Your collection" : "Collector"}
                  </span>
                </div>
                <h1 className="font-sf-pro-rounded text-white text-[24px] md:text-[28px] font-bold tracking-[-0.02em] break-all">
                  {profile.address.slice(0, 10)}…{profile.address.slice(-8)}
                </h1>
              </div>

              <div className="flex gap-8">
                <div>
                  <p className="font-mono-data text-[10px] tracking-[0.2em] uppercase text-white/40 mb-1">
                    Cards held
                  </p>
                  <p className="text-white text-[24px] font-bold tabular-nums">{profile.cardCount}</p>
                </div>
                <div>
                  <p className="font-mono-data text-[10px] tracking-[0.2em] uppercase text-white/40 mb-1">
                    Reference value
                  </p>
                  <div className="flex items-center gap-2">
                    <Image src="/coin.svg" alt="" width={20} height={20} className="mt-0.5" />
                    <p className="text-white text-[24px] font-bold tabular-nums">
                      {formatUnits(profile.insuredValue, 6)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-white/30 text-[11.5px] mt-4">{profile.insuredValueBasis}.</p>
          </div>
        </Reveal>

        <div className="flex gap-2 mb-6">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`btn-anim px-4 py-2 rounded-xl text-[13.5px] font-semibold transition-colors ${
                tab === key
                  ? "nav-active text-white border border-[#FFFFFF47]"
                  : "glass-soft text-white/50 hover:text-white/85 border border-transparent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "cards" && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {profile.cards.length === 0 && (
              <p className="text-white/40 text-[14px] col-span-full">No cards held.</p>
            )}
            {profile.cards.map((card, i) => (
              <Reveal key={`${card.chainId}-${card.tokenId}`} y={24} delay={Math.min(i * 60, 320)}>
              <Card
                href={`/card/${card.tokenId}?chainId=${card.chainId}`}
                name={card.name}
                subtitle={`#${card.tokenId} · ${card.setName ?? "—"}`}
                year={card.year}
                grade={card.grade}
                imageUrl={card.imageUrl}
              />
              </Reveal>
            ))}
          </div>
        )}

        {tab === "draws" && (
          <Reveal y={22} className="glass rounded-2xl overflow-hidden block">
            {profile.draws.length === 0 ? (
              <p className="text-white/40 text-[14px] p-6">No packs opened.</p>
            ) : (
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="border-b border-white/10">
                    {["Draw", "Outcome", "When"].map((h) => (
                      <th
                        key={h}
                        className="text-left font-mono-data text-[10.5px] tracking-[0.15em] uppercase text-white/40 px-5 py-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profile.draws.map((d) => (
                    <tr key={`${d.chainId}-${d.drawId}`} className="border-b border-white/[0.06]">
                      <td className="px-5 py-3 text-white/80 font-mono-data text-[12.5px]">#{d.drawId}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-[12.5px] font-semibold ${
                            d.status === "delivered"
                              ? "text-[#2BD383]"
                              : d.status === "refunded"
                                ? "text-white/45"
                                : "text-[#FFD36B]"
                          }`}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-white/45">{new Date(d.at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Reveal>
        )}

        {tab === "trades" && (
          <Reveal y={22} className="glass rounded-2xl overflow-hidden block">
            {profile.trades.length === 0 ? (
              <p className="text-white/40 text-[14px] p-6">No trades yet.</p>
            ) : (
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="border-b border-white/10">
                    {["Card", "Side", "Price", "Counterparty", "When"].map((h) => (
                      <th
                        key={h}
                        className="text-left font-mono-data text-[10.5px] tracking-[0.15em] uppercase text-white/40 px-5 py-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profile.trades.map((t, i) => (
                    <tr key={i} className="border-b border-white/[0.06]">
                      <td className="px-5 py-3 text-white/80">#{t.tokenId}</td>
                      <td className="px-5 py-3">
                        <span className={t.side === "sold" ? "text-[#FFD36B]" : "text-[#2BD383]"}>
                          {t.side}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-white/85 tabular-nums">${formatUnits(t.price, 6)}</td>
                      <td className="px-5 py-3 text-white/45 font-mono-data text-[12px]">
                        {t.counterparty?.slice(0, 10)}…
                      </td>
                      <td className="px-5 py-3 text-white/45">{new Date(t.at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Reveal>
        )}
      </div>
    </div>
  );
}
