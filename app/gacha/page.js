"use client";

import { useState } from "react";
import HomeHero from "../components/home/HomeHero";
import FeaturedDrops from "../components/home/FeaturedDrops";
import PackOpenModal from "../components/home/PackOpenModal";

export default function GachaPage() {
  const [opening, setOpening] = useState(false);

  return (
    <main className="relative min-h-screen">
      <HomeHero onOpen={() => setOpening(true)} />
      <FeaturedDrops />
      <PackOpenModal open={opening} onClose={() => setOpening(false)} />
    </main>
  );
}
