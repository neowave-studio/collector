"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";

/**
 * The collectible card tile, shared by the marketplace, profile and featured-drop grids.
 *
 * Kept from the original design — the hover lift, the grade chip, the coin-marked value — but the
 * content is passed in rather than baked in, and the action under the price is a slot so the same
 * tile can carry "Buy now" in one grid and a list-price field in another.
 */

/**
 * Grades arrive as grading-company strings ("PSA 10"), not as the S/A/B letters the original tile
 * assumed, so map the numeric grade onto the rarity palette. Anything unrecognised is styled as
 * ungraded rather than guessed at — a card shown in gold it has not earned misleads a buyer.
 */
export function rarityClass(grade) {
  if (!grade) return "rarity-ungraded";
  const g = String(grade).toUpperCase();

  const numeric = g.match(/(\d+(?:\.\d+)?)/);
  if (numeric) {
    const n = Number(numeric[1]);
    if (n >= 10) return "rarity-s";
    if (n >= 9) return "rarity-a";
    if (n >= 8) return "rarity-b";
    return "rarity-ungraded";
  }

  if (g.startsWith("S")) return "rarity-s";
  if (g.startsWith("A")) return "rarity-a";
  if (g.startsWith("B")) return "rarity-b";
  return "rarity-ungraded";
}

export default function Card({
  href,
  name,
  subtitle,
  year,
  grade,
  imageUrl,
  valueLabel = "Insured Value",
  value,
  action,
}) {
  const router = useRouter();

  return (
    <div
      onClick={href ? () => router.push(href) : undefined}
      className={`group relative bg-[#101010] rounded-[12px] overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] border border-[#FFFFFF1A] hover:border-[#2BD383]/40 hover:shadow-[0_20px_50px_-16px_rgba(43,211,131,0.45)] ${
        href ? "hover:-translate-y-1.5 cursor-pointer" : ""
      }`}
    >
      <div className="relative">
        {year && (
          <div className="absolute top-3 left-3 text-[#FFFFFF99] font-[500] text-[14px] leading-[140%] backdrop-blur-sm px-2 py-1 rounded z-10">
            {year}
          </div>
        )}
        {grade && (
          <div
            className={`absolute top-3 right-3 rounded-lg px-3 py-0 min-w-fit flex justify-center text-[#FFFFFF99] font-[700] text-[14px] leading-[150%] border z-10 ${rarityClass(grade)}`}
          >
            {grade}
          </div>
        )}

        <div className="flex items-center w-full justify-center px-14 pt-14">
          <div className="w-full aspect-[5/7] overflow-hidden rounded-lg">
            {imageUrl && (
              <img
                src={imageUrl}
                alt={name}
                className="w-full h-full object-contain rounded-lg transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-105"
              />
            )}
          </div>
        </div>
      </div>

      <div className="px-4 py-2 pb-4">
        <h3 className="text-white font-bold text-[22px] leading-[150%] truncate">{name}</h3>
        <p className="text-[#FFFFFF99] font-[500] text-[14px] leading-[140%] mb-4 truncate">
          {subtitle}
        </p>

        {value != null && (
          <div className="mb-5">
            <p className="text-[#FFFFFF99] font-[500] text-[14px] leading-[140%] mb-2">{valueLabel}</p>
            <div className="flex items-center justify-start gap-2">
              <Image src="/coin.svg" alt="" width={24} height={24} className="mt-1" />
              <p className="text-[#FFFFFF] font-[700] text-[18px] leading-[150%] tabular-nums">
                {value}
              </p>
            </div>
          </div>
        )}

        {/* The action sits inside the clickable tile, so stop the click from also navigating. */}
        {action && (
          <div onClick={(e) => e.stopPropagation()} role="presentation">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
