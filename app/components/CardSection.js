"use client";
import { useState } from "react";
import Card from "./Card";
import Pagination from "./Pagination";
import chari from "../../public/chari.svg"
export default function CardSection() {
  const [currentPage, setCurrentPage] = useState(1);
  const cardsPerPage = 8;

  // Dummy card data
  const allCards = [
    {
      id: 1,
      name: "Charizard Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "S+",
      price: "2,600.00",
      image: "/chari.png",
    },
    {
      id: 2,
      name: "Mewtwo Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "B",
      price: "2,600.00",
    image: "/chari.png",
    },
    {
      id: 3,
      name: "Venusaur Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "B",
      price: "2,600.00",
    image: "/chari.png",
    },
    {
      id: 4,
      name: "Pikachu Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "A+",
      price: "2,600.00",
    image: "/chari.png",
    },
    {
      id: 5,
      name: "Lugia Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "A+",
      price: "2,600.00",
    image: "/chari.png",
    },
    {
      id: 6,
      name: "Beedrill Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "S+",
      price: "2,600.00",
     image: "/chari.png",
    },
    {
      id: 7,
      name: "Blastoise Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "Ungraded",
      price: "2,600.00",
      image: "/chari.svg",
    },
    {
      id: 8,
      name: "Solgaleo Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2019",
      rarity: "B",
      price: "2,600.00",
      image: "/chari.svg",
    },
    {
      id: 9,
      name: "Rayquaza Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2020",
      rarity: "S+",
      price: "3,200.00",
       image: "/chari.svg",
    },
    {
      id: 10,
      name: "Gyarados Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2020",
      rarity: "A+",
      price: "2,800.00",
       image: "/chari.svg",
    },
    {
      id: 11,
      name: "Dragonite Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2020",
      rarity: "B",
      price: "2,400.00",
       image: "/chari.svg",
    },
    {
      id: 12,
      name: "Alakazam Holo Rare",
      collection: "36 Packs (Sun & Moon Series)",
      year: "2020",
      rarity: "A+",
      price: "2,700.00",
      image: "/chari.svg",
    },
  ];

  // Pagination logic
  const totalPages = Math.ceil(allCards.length / cardsPerPage);
  const indexOfLastCard = currentPage * cardsPerPage;
  const indexOfFirstCard = indexOfLastCard - cardsPerPage;
  const currentCards = allCards.slice(indexOfFirstCard, indexOfLastCard);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const handleBuyClick = (card) => {
    console.log("Buy clicked for:", card);
    // Add your buy logic here
    // For example: open modal, navigate to checkout, etc.
  };

  return (
    <section
      className="relative w-full lg:py-16 md:py-12 py-8 lg:px-4 md:px-4 px-4 bg-black"
      id="marketplace"
    >
      <div className="max-w-[1400px] mx-auto">
        {/* Header */}


        {/* Cards Grid */}
        <div className="grid lg:grid-cols-4 md:grid-cols-2 grid-cols-1 gap-6 mb-12">
          {currentCards.map((card) => (
            <Card key={card.id} card={card} onBuyClick={handleBuyClick} />
          ))}
        </div>

        {/* Pagination */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          totalItems={allCards.length}
          itemsPerPage={cardsPerPage}
        />
      </div>
    </section>
  );
}