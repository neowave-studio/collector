"use client";

/**
 * Loading skeletons.
 *
 * Every skeleton here mirrors the exact box it stands in for — same paddings, aspect ratios and text
 * heights as the real component — so a request in flight reserves the right space and the layout does
 * not jump when the data lands. `.skeleton` (globals.css) carries the shimmer.
 */

export function Skeleton({ className = "" }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Matches the `Card` tile: framed image (5/7), title, subtitle, value block, action row. */
export function CardSkeleton() {
  return (
    <div className="bg-[#101010] rounded-[12px] overflow-hidden border border-[#FFFFFF1A]">
      <div className="flex items-center w-full justify-center px-14 pt-14">
        <div className="w-full aspect-[5/7] rounded-lg skeleton" />
      </div>
      <div className="px-4 py-2 pb-4">
        <Skeleton className="h-[20px] w-3/4 mb-2.5" />
        <Skeleton className="h-[13px] w-1/2 mb-4" />
        <Skeleton className="h-[13px] w-24 mb-2.5" />
        <Skeleton className="h-[22px] w-20 mb-5" />
        <Skeleton className="h-[46px] w-full rounded-[16px]" />
      </div>
    </div>
  );
}

/** A grid of card skeletons that matches the marketplace / profile / featured grids. */
export function CardGridSkeleton({ count = 6, className = "grid sm:grid-cols-2 lg:grid-cols-3 gap-5" }) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** A stack of glass-soft "row" skeletons, for the reserves / packs / list views. */
export function RowSkeleton({ count = 3, className = "" }) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass-soft rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex-1">
            <Skeleton className="h-[14px] w-40 mb-2" />
            <Skeleton className="h-[11px] w-56 max-w-full" />
          </div>
          <Skeleton className="h-[24px] w-24 rounded-lg" />
        </div>
      ))}
    </div>
  );
}
