"use client";

import { useState } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";
import { api, formatUnits } from "../lib/api";
import Reveal from "../components/Reveal";
import LeaderboardPodium from "../components/LeaderboardPodium";
import Pagination from "../components/Pagination";
import { Skeleton } from "../components/Skeleton";

/**
 * Leaderboard.
 *
 * Ranked on cards actually held on-chain, valued at their committed reference prices — not on an
 * invented points score. A points number nobody can check would sit oddly in a product whose whole
 * argument is that its figures are verifiable, so the basis is stated on the page.
 *
 * The podium and pagination come from the original design. The columns it shipped with — primary,
 * total and bonus points, plus referrals — do not appear, because no such quantity exists anywhere
 * in the contracts or the indexer; every column here is something a reader could go and check.
 */
const PER_PAGE = 10;

export default function LeaderboardPage() {
  const chainId = useChainId();
  const { address } = useAccount();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard", chainId],
    queryFn: () => api.leaderboard(chainId),
    refetchInterval: 30_000,
  });

  const entries = data?.entries ?? [];
  const totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  // A refetch can shrink the list under us; clamp rather than render an empty page.
  const current = Math.min(page, totalPages);
  const visible = entries.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  return (
    <main className="min-h-screen pt-[130px] pb-24 lg:px-8 md:px-6 px-4">
      <div className="max-w-[1000px] mx-auto">
        <Reveal y={20}>
          <div className="flex items-center gap-3 mb-3">
            <span className="iri-divider w-8" />
            <span className="font-mono-data text-[11px] tracking-[0.35em] uppercase iri-text">
              Top collectors
            </span>
          </div>
          <h1 className="font-sf-pro-rounded text-white text-[30px] md:text-[38px] font-bold tracking-[-0.02em] mb-2">
            Leaderboard
          </h1>
          <p className="text-white/45 text-[13.5px] mb-8">
            {data?.basis ?? "Ranked on cards held on-chain."}
          </p>
        </Reveal>

        {isLoading && (
          <div className="glass rounded-2xl overflow-hidden">
            <div className="border-b border-white/10 px-5 py-3.5 flex gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className={`h-[11px] ${i === 1 ? "flex-1" : "w-16"}`} />
              ))}
            </div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="border-b border-white/[0.06] px-5 py-4 flex items-center gap-4"
              >
                <Skeleton className="h-[14px] w-6 shrink-0" />
                <Skeleton className="h-[14px] flex-1 max-w-[220px]" />
                <Skeleton className="h-[14px] w-12 ml-auto shrink-0" />
                <Skeleton className="h-[14px] w-12 shrink-0" />
                <Skeleton className="h-[14px] w-20 shrink-0" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && entries.length === 0 && (
          <Reveal y={20} className="glass-soft rounded-2xl p-8 text-center block">
            <p className="text-white/60 text-[15px] mb-1">Nobody holds a card yet.</p>
            <a href="/gacha" className="link-underline btn-anim inline-block text-white/80 text-[13.5px]">
              Be the first — open a pack →
            </a>
          </Reveal>
        )}

        {entries.length > 0 && (
          <Reveal y={24}>
            <LeaderboardPodium entries={entries} address={address} />
          </Reveal>
        )}

        {entries.length > 0 && (
          <Reveal y={24} delay={120}>
          <div className="glass rounded-2xl overflow-hidden">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-white/10">
                  {["Rank", "Collector", "Cards", "Packs", "Reference value"].map((h, i) => (
                    <th
                      key={h}
                      className={`font-mono-data text-[10.5px] tracking-[0.15em] uppercase text-white/40 px-5 py-3.5 ${
                        i > 1 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => {
                  const isMe = address && entry.address.toLowerCase() === address.toLowerCase();
                  return (
                    <tr
                      key={entry.address}
                      className={`border-b border-white/[0.06] transition-colors duration-200 ${
                        isMe ? "bg-[#2BD383]/[0.07]" : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <td className="px-5 py-3.5">
                        <span
                          className={`font-bold tabular-nums ${
                            entry.rank === 1
                              ? "text-[#FFD36B]"
                              : entry.rank <= 3
                                ? "text-white/85"
                                : "text-white/45"
                          }`}
                        >
                          {entry.rank}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <a
                          href={`/profile/${entry.address}`}
                          className="link-underline btn-anim inline-block text-white/85 hover:text-white font-mono-data text-[12.5px]"
                        >
                          {entry.address.slice(0, 10)}…{entry.address.slice(-6)}
                        </a>
                        {isMe && (
                          <span className="ml-2 text-[#2BD383] text-[11.5px] font-semibold">you</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right text-white/80 tabular-nums">
                        {entry.cardCount}
                      </td>
                      <td className="px-5 py-3.5 text-right text-white/55 tabular-nums">
                        {entry.packsOpened}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2">
                          <Image src="/coin.svg" alt="" width={18} height={18} className="mt-0.5" />
                          <span className="text-white font-semibold tabular-nums">
                            {formatUnits(entry.referenceValue, 6)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </Reveal>
        )}

        {totalPages > 1 && (
          <div className="mt-6">
            <Pagination
              currentPage={current}
              totalPages={totalPages}
              onPageChange={setPage}
              totalItems={entries.length}
              itemsPerPage={PER_PAGE}
            />
          </div>
        )}
      </div>
    </main>
  );
}
