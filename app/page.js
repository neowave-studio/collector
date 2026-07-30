"use client";

import { useRouter } from "next/navigation";
import HomeHero from "./components/home/HomeHero";
import FeaturedDrops from "./components/home/FeaturedDrops";
import { usePack } from "./hooks/usePack";

/**
 * Landing page.
 *
 * Shows the same live pack as the gacha page — via the shared `usePack` hook rather than its own copy
 * of the logic, because this page previously rendered `<HomeHero />` with no props and was therefore
 * permanently stuck showing dashes and an empty odds panel.
 *
 * The CTA routes to /gacha rather than starting a purchase here. Opening a pack needs a session, an
 * age attestation and a modal to reveal into; duplicating that flow on two pages is how they diverge in
 * the first place.
 */
export default function HomePage() {
  const router = useRouter();
  const { pack, displayChainId, packsLoading } = usePack();

  return (
    <main className="relative min-h-screen">
      <HomeHero
        pack={pack}
        loading={packsLoading}
        chainId={displayChainId}
        onOpen={() => router.push("/gacha")}
      />
      <FeaturedDrops />
    </main>
  );
}
