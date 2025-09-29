"use client";

import { useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import Card from "@/app/components/Card";

export default function CardDetailsPage({ cardId }) {
  const [selectedImage, setSelectedImage] = useState(0);

  // Similar cards data
  const similarCards = [
    {
      id: 2,
      name: "Charizard Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "A+",
      price: "2,600.00",
      image: "/card1.png",
    },
    {
      id: 3,
      name: "Mewtwo Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "A+",
      price: "2,600.00",
      image: "/card2.png",
    },
    {
      id: 4,
      name: "Venusaur Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "A+",
      price: "2,600.00",
      image: "/card3.png",
    },
    {
      id: 5,
      name: "Pikachu Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "A+",
      price: "2,600.00",
      image: "/card4.png",
    },
    {
      id: 6,
      name: "Lugia Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "A+",
      price: "2,600.00",
      image: "/card5.png",
    },
    {
      id: 7,
      name: "Beedrill Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "A+",
      price: "2,600.00",
      image: "/card6.png",
    },
    {
      id: 8,
      name: "Blastoise Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "A+",
      price: "2,600.00",
      image: "/card7.png",
    },
    {
      id: 9,
      name: "Solgaleo Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "A+",
      price: "2,600.00",
      image: "/card8.png",
    },
  ];

  const handleBuyClick = (card) => {
    console.log("Buy clicked for:", card);
    // Add your buy logic here
  };

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
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left Side - Images */}
          <div>
            {/* Main Image */}
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-8 mb-4">
              <div className="aspect-[3/4] bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg flex items-center justify-center">
                <div className="w-full h-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg flex items-center justify-center">
                  <div className="text-gray-600 text-sm">Card Image</div>
                </div>
              </div>
            </div>

            {/* Thumbnail Images */}
            <div className="flex gap-4">
              {cardData.images.map((img, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedImage(index)}
                  className={`w-20 h-28 bg-gray-900 rounded-lg border-2 transition-colors ${
                    selectedImage === index
                      ? "border-emerald-500"
                      : "border-gray-800 hover:border-gray-700"
                  }`}
                >
                  <div className="w-full h-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg"></div>
                </button>
              ))}
            </div>
          </div>

          {/* Right Side - Details */}
          <div>
            {/* Badge and Title */}
            <div className="mb-6">
              <div className="inline-block px-3 py-1 bg-yellow-500/20 border border-yellow-500/50 rounded text-yellow-400 text-xs font-bold mb-3">
                {cardData.rarity}
              </div>
              <h1 className="text-white text-3xl font-bold mb-2">
                {cardData.name}
              </h1>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-400">
                  Owned by{" "}
                  <span className="text-emerald-400">{cardData.owner}</span>
                </span>
                <span className="text-gray-400">{cardData.year}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mb-6">
              <button className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors">
                Buy Now
              </button>
              <button className="px-6 py-2.5 bg-transparent border border-gray-700 hover:border-emerald-500 text-white rounded-lg font-semibold transition-colors">
                Vault
              </button>
              <button className="px-6 py-2.5 bg-transparent border border-gray-700 hover:border-emerald-500 text-white rounded-lg font-semibold transition-colors">
                Contract
              </button>
            </div>

            {/* Card Info Grid */}
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-400 text-sm mb-1">Grading Company</p>
                  <p className="text-white font-semibold">{cardData.gradingCompany}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">PSA</p>
                  <p className="text-white font-semibold">{cardData.gradingId}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">Grade</p>
                  <p className="text-white font-semibold">{cardData.grade}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">Authenticated</p>
                  <p className="text-white font-semibold">{cardData.authenticated}</p>
                </div>
              </div>
            </div>

            {/* Price Section */}
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 mb-6">
              <p className="text-gray-400 text-sm mb-2">Asking Price</p>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-6 h-6 rounded-full bg-emerald-500"></div>
                <span className="text-white text-3xl font-bold">
                  {cardData.askingPrice}
                </span>
              </div>
              <div className="flex gap-3">
                <button className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors">
                  Buy Now 🔒
                </button>
                <button className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-semibold transition-colors">
                  Make an offer 💰
                </button>
              </div>
            </div>

            {/* Verified Badge */}
            <div className="flex items-center gap-2 text-sm mb-6">
              <div className="w-5 h-5 rounded-full bg-emerald-600 flex items-center justify-center">
                <span className="text-white text-xs">✓</span>
              </div>
              <span className="text-white">Verified by BGS</span>
            </div>

            {/* Collapsible Sections */}
            <div className="space-y-3">
              {/* Activities */}
              <div className="bg-gray-900/50 rounded-xl border border-gray-800">
                <button className="w-full px-6 py-4 flex items-center justify-between text-white hover:bg-gray-800/30 transition-colors rounded-xl">
                  <span className="font-semibold">Activities</span>
                  <FiChevronDown />
                </button>
              </div>

              {/* Offers */}
              <div className="bg-gray-900/50 rounded-xl border border-gray-800">
                <button className="w-full px-6 py-4 flex items-center justify-between text-white hover:bg-gray-800/30 transition-colors rounded-xl">
                  <span className="font-semibold">Offers</span>
                  <FiChevronDown />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Similar Cards Section */}
        <div className="mt-16">
          <h2 className="text-white text-2xl font-bold mb-6">
            Similar Cards You Might Like
          </h2>
          <div className="grid lg:grid-cols-4 md:grid-cols-2 grid-cols-1 gap-6">
            {similarCards.map((card) => (
              <Card key={card.id} card={card} onBuyClick={handleBuyClick} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}