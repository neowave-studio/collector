"use client";

import { useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import Card from '../components/Card';
import Pagination from '../components/Pagniation';
export default function MarketplacePage() {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('newest');
  const [filters, setFilters] = useState({
    status: 'buy-now',
    priceMin: 30,
    priceMax: 400,
    insuredMin: 30,
    insuredMax: 400,
    year: { min: 2019, max: 2024 },
    beckett: false,
    owner: '',
    authenticated: false,
    anonymized: false
  });

  const cardsPerPage = 9;

  // Dummy card data
  const allCards = [
    { id: 1, name: "Charizard Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "A+", price: "2,600.00", image: "/card1.png" },
    { id: 2, name: "Mewtwo Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "A+", price: "2,600.00", image: "/card2.png" },
    { id: 3, name: "Venusaur Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "C+", price: "2,600.00", image: "/card3.png" },
    { id: 4, name: "Lugia Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "B", price: "2,600.00", image: "/card4.png" },
    { id: 5, name: "Beedrill Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "C+", price: "2,600.00", image: "/card5.png" },
    { id: 6, name: "Pikachu Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "C+", price: "2,600.00", image: "/card6.png" },
    { id: 7, name: "Blastoise Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "Ungraded", price: "2,600.00", image: "/card7.png" },
    { id: 8, name: "Solgaleo Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "C+", price: "2,600.00", image: "/card8.png" },
    { id: 9, name: "Rayquaza Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2019", rarity: "B", price: "2,600.00", image: "/card9.png" },
    { id: 10, name: "Gyarados Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2020", rarity: "A+", price: "2,800.00", image: "/card1.png" },
    { id: 11, name: "Dragonite Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2020", rarity: "B", price: "2,400.00", image: "/card2.png" },
    { id: 12, name: "Alakazam Holo Rare", collection: "36 Packs (Sun & Moon Series)", year: "2020", rarity: "A+", price: "2,700.00", image: "/card3.png" },
  ];

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
  };

  return (
    <div className="min-h-screen bg-black pt-20">
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-white text-3xl font-bold">Marketplace</h1>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-400">Hide Owned Cards</span>
              <div className="flex items-center gap-2 px-3 py-1 bg-gray-800 rounded-lg">
                <div className="w-4 h-4 rounded-full bg-emerald-500"></div>
                <span className="text-white">3</span>
              </div>
            </div>
          </div>
          <p className="text-gray-400 text-sm">Total: 32,875 cards</p>
        </div>

        <div className="flex gap-6">
          {/* Sidebar Filters */}
          <div className="w-64 flex-shrink-0">
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4 space-y-6">
              
              {/* Search */}
              <div>
                <input
                  type="text"
                  placeholder="Search Cards by Name"
                  className="w-full px-3 py-2 bg-gray-800 text-white text-sm rounded-lg border border-gray-700 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Status Filter */}
              <div>
                <h3 className="text-white font-semibold mb-3 text-sm">Status</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setFilters({...filters, status: 'buy-now'})}
                    className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      filters.status === 'buy-now'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    Buy Now
                  </button>
                  <button
                    onClick={() => setFilters({...filters, status: 'offers'})}
                    className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      filters.status === 'offers'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    Offers
                  </button>
                </div>
              </div>

              {/* Grade Filter */}
              <div>
                <h3 className="text-white font-semibold mb-3 text-sm">Grade</h3>
                <div className="space-y-2">
                  {['Any', 'Grail', 'Open to Offers', 'Open to Trade'].map((grade) => (
                    <button
                      key={grade}
                      className="w-full px-3 py-2 bg-gray-800 text-gray-400 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors text-left"
                    >
                      {grade}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Range */}
              <div>
                <h3 className="text-white font-semibold mb-3 text-sm">Price Range</h3>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="number"
                    value={filters.priceMin}
                    onChange={(e) => setFilters({...filters, priceMin: e.target.value})}
                    className="w-full px-2 py-1.5 bg-gray-800 text-white text-sm rounded border border-gray-700"
                    placeholder="$30"
                  />
                  <span className="text-gray-500">-</span>
                  <input
                    type="number"
                    value={filters.priceMax}
                    onChange={(e) => setFilters({...filters, priceMax: e.target.value})}
                    className="w-full px-2 py-1.5 bg-gray-800 text-white text-sm rounded border border-gray-700"
                    placeholder="$400"
                  />
                </div>
                <input
                  type="range"
                  min="30"
                  max="400"
                  value={filters.priceMax}
                  onChange={(e) => setFilters({...filters, priceMax: e.target.value})}
                  className="w-full accent-emerald-600"
                />
              </div>

              {/* Insured Value */}
              <div>
                <h3 className="text-white font-semibold mb-3 text-sm">Insured Value</h3>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="number"
                    value={filters.insuredMin}
                    onChange={(e) => setFilters({...filters, insuredMin: e.target.value})}
                    className="w-full px-2 py-1.5 bg-gray-800 text-white text-sm rounded border border-gray-700"
                    placeholder="$30"
                  />
                  <span className="text-gray-500">-</span>
                  <input
                    type="number"
                    value={filters.insuredMax}
                    onChange={(e) => setFilters({...filters, insuredMax: e.target.value})}
                    className="w-full px-2 py-1.5 bg-gray-800 text-white text-sm rounded border border-gray-700"
                    placeholder="$400"
                  />
                </div>
                <input
                  type="range"
                  min="30"
                  max="400"
                  value={filters.insuredMax}
                  onChange={(e) => setFilters({...filters, insuredMax: e.target.value})}
                  className="w-full accent-emerald-600"
                />
              </div>

              {/* Year */}
              <div>
                <h3 className="text-white font-semibold mb-3 text-sm">Year</h3>
                <div className="relative">
                  <select className="w-full px-3 py-2 bg-gray-800 text-white text-sm rounded-lg border border-gray-700 appearance-none cursor-pointer">
                    <option>YYYY - YYYY</option>
                    <option>2019 - 2024</option>
                    <option>2020 - 2024</option>
                  </select>
                  <FiChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                </div>
              </div>

              {/* Beckett */}
              <div>
                <h3 className="text-white font-semibold mb-3 text-sm">Beckett</h3>
                <div className="relative">
                  <select className="w-full px-3 py-2 bg-gray-800 text-white text-sm rounded-lg border border-gray-700 appearance-none cursor-pointer">
                    <option>Beckett</option>
                  </select>
                  <FiChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                </div>
              </div>

              {/* Owner */}
              <div>
                <h3 className="text-white font-semibold mb-3 text-sm">Owner</h3>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Enter Owner Address"
                    className="w-full px-3 py-2 bg-gray-800 text-white text-sm rounded-lg border border-gray-700"
                  />
                </div>
              </div>

              {/* Checkboxes */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.authenticated}
                    onChange={(e) => setFilters({...filters, authenticated: e.target.checked})}
                    className="w-4 h-4 rounded accent-emerald-600"
                  />
                  <span className="text-gray-400 text-sm">Authenticated</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.anonymized}
                    onChange={(e) => setFilters({...filters, anonymized: e.target.checked})}
                    className="w-4 h-4 rounded accent-emerald-600"
                  />
                  <span className="text-gray-400 text-sm">Anonymized</span>
                </label>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1">
            {/* Sort and Filters Bar */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <button className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg flex items-center gap-2 transition-colors">
                  <span>Sort by:</span>
                  <span className="font-semibold">Newest</span>
                  <FiChevronDown />
                </button>
                <button className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg flex items-center gap-2 transition-colors">
                  <span>Filters</span>
                  <span className="px-2 py-0.5 bg-emerald-600 rounded text-xs">3</span>
                </button>
              </div>
            </div>

            {/* Cards Grid */}
            <div className="grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4 mb-8">
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
        </div>
      </div>
    </div>
  );
}