"use client";

import Card from "../Card";
import Reveal from "../Reveal";

const FEATURED = [
  { id: 1, name: "Charizard Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "S+", price: "2,600.00", image: "/chari.png" },
  { id: 2, name: "Mewtwo Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "B", price: "2,600.00", image: "/chari.png" },
  { id: 3, name: "Venusaur Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "B", price: "2,600.00", image: "/chari.png" },
  { id: 4, name: "Pikachu Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "A+", price: "2,600.00", image: "/chari.png" },
  { id: 5, name: "Lugia Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "A+", price: "2,600.00", image: "/chari.png" },
  { id: 6, name: "Beedrill Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "S+", price: "2,600.00", image: "/chari.png" },
  { id: 7, name: "Blastoise Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "Ungraded", price: "2,600.00", image: "/chari.svg" },
  { id: 8, name: "Solgaleo Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "B", price: "2,600.00", image: "/chari.svg" },
];

export default function FeaturedDrops() {
  return (
    <section className="relative lg:px-8 md:px-6 px-4 pb-24">
      <div className="max-w-[1300px] mx-auto">
        <Reveal y={24}>
          <div className="flex items-end justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="iri-divider w-8" />
                <span className="font-mono-data text-[10px] md:text-[11px] tracking-[0.35em] uppercase iri-text">
                  Fresh pulls
                </span>
              </div>
              <h2 className="font-sf-pro-rounded text-white text-[26px] md:text-[32px] font-bold tracking-[-0.02em]">
                Featured drops
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

        <div className="grid lg:grid-cols-4 md:grid-cols-2 grid-cols-1 gap-5">
          {FEATURED.map((card, i) => (
            <Reveal
              key={card.id}
              className="h-full relative hover:z-20"
              y={30}
              delay={i * 70}
            >
              <Card card={card} onBuyClick={() => {}} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
