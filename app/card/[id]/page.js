"use client";

import { useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import Card from "@/app/components/Card";
import CardSection from "@/app/components/CardSection";
import GachaHeroSection from "@/app/components/HeroSection";
import SingleCardSection from "@/app/components/SingleCardSection";
import Reveal from "@/app/components/Reveal";

export default function CardDetailsPage({ cardId }) {
  const [selectedImage, setSelectedImage] = useState(0);


  // Mock card data - replace with actual data fetching
  const cardData = {
    id: cardId || 1,
    name: "2006 Celebi Gold Star - EX Crystal Guardians",
    year: "2006",
    rarity: "Rare",
    images: [
      "/card-large.png",
      "/card-back.png"
    ],
    owner: "0x0...4214BR",
    gradingCompany: "PSA",
    gradingId: "83054455290",
    grade: "GEM-MT 10",
    authenticated: "Yes",
    askingPrice: "2,600.00",
    activities: [],
    offers: []
  };

  return (
    <div className="min-h-screen bg-black pt-20">
      <div className="max-w-[1400px] mx-auto px-6 py-8">

<SingleCardSection/>

        {/* Similar Cards Section */}
        <Reveal className="mt-16" y={30} delay={80}>
          <h2 className="text-white text-2xl font-bold mb-0">
            Similar Cards You Might Like
          </h2>
     <CardSection/>
        </Reveal>
      </div>
    </div>
  );
}