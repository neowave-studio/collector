"use client";

import Image from "next/image";
import { formatUnits } from "../lib/api";

/**
 * Top-three podium.
 *
 * Kept from the original design, but the pedestals are fed by chain state rather than by a fixed
 * array: height and order follow the real ranking, so if only two collectors hold cards only two
 * pedestals appear. The figure under each name is committed reference value — the same basis the
 * table below uses, and labelled once at the top of the page rather than restated per pedestal.
 */

const PLACES = [
  // Rendered in visual order (2nd, 1st, 3rd) so the winner stands in the middle.
  {rank: 2, height: "h-28 md:h-32", avatar: "w-20 h-20 md:w-24 md:h-24", ring: "from-white/50 to-white/20", badge: "bg-white/80 text-black", pedestal: "from-white/30 to-white/[0.07]", numeral: "text-white/25", icon: "🥈", lift: ""},
  {rank: 1, height: "h-36 md:h-40", avatar: "w-24 h-24 md:w-32 md:h-32", ring: "from-[#FFD36B] to-[#B98424]", badge: "bg-[#FFD36B] text-black", pedestal: "from-[#FFD36B]/35 to-[#FFD36B]/[0.06]", numeral: "text-[#FFD36B]/30", icon: "👑", lift: "-mt-8"},
  {rank: 3, height: "h-24 md:h-28", avatar: "w-20 h-20 md:w-24 md:h-24", ring: "from-[#C98A4B] to-[#7A4E22]", badge: "bg-[#C98A4B] text-black", pedestal: "from-[#C98A4B]/30 to-[#C98A4B]/[0.06]", numeral: "text-[#C98A4B]/30", icon: "🥉", lift: ""},
];

export default function LeaderboardPodium({entries, address}) {
  const byRank = new Map(entries.map((e) => [e.rank, e]));
  // Only render a pedestal that has somebody standing on it.
  const places = PLACES.filter((p) => byRank.has(p.rank));
  if (places.length === 0) return null;

  return (
    <div className="flex items-end justify-center gap-4 md:gap-8 mb-14">
      {places.map((place) => {
        const entry = byRank.get(place.rank);
        const isMe = address && entry.address.toLowerCase() === address.toLowerCase();

        return (
          <div key={place.rank} className={`flex flex-col items-center ${place.lift}`}>
            <div className="relative mb-3">
              <div className={`${place.avatar} rounded-full bg-gradient-to-br ${place.ring} p-[2px]`}>
                <div className="w-full h-full rounded-full bg-[#0d0d0d] flex items-center justify-center">
                  <span className={place.rank === 1 ? "text-[28px] md:text-[36px]" : "text-[22px] md:text-[26px]"}>
                    {place.icon}
                  </span>
                </div>
              </div>
              <span
                className={`absolute -bottom-1 left-1/2 -translate-x-1/2 ${place.badge} text-[11px] px-2 py-0.5 rounded-full font-bold tabular-nums`}
              >
                {place.rank}
              </span>
            </div>

            <a
              href={`/profile/${entry.address}`}
              className="link-underline text-white/90 hover:text-white font-mono-data text-[12px] md:text-[13px]"
            >
              {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
            </a>
            {isMe && <span className="text-[#2BD383] text-[11px] font-semibold mt-0.5">you</span>}

            <div className="flex items-center gap-1.5 mt-1.5">
              <Image src="/coin.svg" alt="" width={16} height={16} className="mt-0.5" />
              <span className="text-white font-semibold text-[13.5px] md:text-[15px] tabular-nums">
                {formatUnits(entry.referenceValue, 6)}
              </span>
            </div>
            <p className="text-white/35 text-[11.5px] mt-0.5 tabular-nums">
              {entry.cardCount} {entry.cardCount === 1 ? "card" : "cards"}
            </p>

            <div
              className={`relative w-24 md:w-32 ${place.height} mt-4 rounded-t-xl bg-gradient-to-b ${place.pedestal} border-x border-t border-white/10 flex items-center justify-center`}
            >
              <span className={`${place.numeral} text-[52px] md:text-[64px] font-bold leading-none tabular-nums`}>
                {place.rank}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
