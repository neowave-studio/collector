"use client";

import { useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import Card from '../components/Card';
import Pagination from '../components/Pagination';
import Image from 'next/image';
import Reveal from '../components/Reveal';
export default function MarketplacePage() {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('newest');
  const [filters, setFilters] = useState({
    status: 'buy-now',
    priceMin: 30,
      selectedTags: [], // Add this
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
        <Reveal className="mb-8 mt-10" y={24} delay={60}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-2">
            <h1 className="text-white text-[24px] font-semibold font-sf-pro-rounded" >Marketplace</h1>
  <div className="flex items-center gap-2 text-sm">
  <span className="text-[#FFFFFF66] text-[16px] font-medium">Hide Owned Cards</span>
  <button
    onClick={() => setFilters({...filters, hideOwnedCards: !filters.hideOwnedCards})}
    className={`relative w-12 h-6 rounded-full transition-colors ${
      filters.hideOwnedCards ? 'bg-[#FFFFFF33]' : 'bg-[#FFFFFF33]'
    }`}
  >
    <div
      className={`absolute top-0.5 w-5 h-5 rounded-full buy-now-button transition-transform ${
        filters.hideOwnedCards ? 'translate-x-6' : 'translate-x-0.5'
      }`}
    />
  </button>
</div>
          </div>
          <p className="text-[#FFFFFF66] text-[16px] font-medium">Total: 32,875 cards</p>
        </Reveal>

                    {/* Sort and Filters Bar */}
<Reveal className="flex flex-col md:flex-row  items-center justify-between gap-4 mb-6" y={24} delay={140}>
  {/* Search Input - Left Side */}
  <div className="flex-1  relative">
    <Image 
      src="/search.svg" 
      width={20} 
      height={20} 
      className="absolute left-4 top-1/2 transform -translate-y-1/2"
      alt="search"
    />
    <input 
      className='w-full pl-10 pr-4 py-2 bg-[#1A1A1A] rounded-[16px]  hover:bg-gray-700 placeholder:text-[#FFFFFF66] text-white text-sm border border-[#FFFFFF0D] transition-colors' 
      value=""  
      placeholder='Search Cards by Name' 
    /> 
  </div>

  {/* Sort and Filter Buttons - Right Side */}
  <div className="flex items-center gap-3">
    <button className="btn-anim px-4 py-2 bg-[#1A1A1A] rounded-[16px] hover:bg-gray-700 text-white text-sm border border-[#FFFFFF0D] flex items-center gap-2 transition-colors">
      <span className='text-[#FFFFFF66] text-[16px] hidden md:flex font-medium'>Sort by:</span>
      <span className="text-[#FFFFFFE5] text-[16px] font-medium">Newest</span>
      <FiChevronDown />
    </button>

    <button className="btn-anim px-4 py-2 bg-[#1A1A1A] rounded-[16px] hover:bg-gray-700 text-white text-sm border border-[#FFFFFF0D] flex items-center gap-2 transition-colors">
      <Image src="/filters.svg" width={20} height={20} alt="filters" />
      <span className='text-[#FFFFFFE5] text-[16px] font-medium'>Filters</span>
      <span className="px-2 py-0.5 bg-[#303030] rounded-full text-[#FFFFFFE5] text-[16px] font-medium">3</span>
    </button>
  </div>
</Reveal>

        <div className="flex md:flex-row flex-col gap-6 ">
          {/* Sidebar Filters */}
<Reveal className="md:max-w-[330px] w-full md:w-[250px] lg:w-[310px] xl:w-[330px] flex-shrink-0" x={-24} y={0} delay={200}>
  <div className="bg-[#101010] rounded-[16px] p-6 space-y-6">
    
    {/* Status Filter */}
    <div>
      <h3 className="text-[#C8C8C8] font-medium mb-3 text-[14px]">Status</h3>
      <div className="flex gap-2">
        <button
          onClick={() => setFilters({...filters, status: 'buy-now'})}
          className={`btn-anim px-4 py-2 rounded-[12px] text-[16px] font-medium transition-colors ${
            filters.status === 'buy-now'
              ? 'sidebar-bg text-black'
              : 'bg-[#FFFFFF0A] text-[#FFFFFF66] hover:bg-[#FFFFFF1A]'
          }`}
        >
          Buy Now
        </button>
        <button
          onClick={() => setFilters({...filters, status: 'offers'})}
          className={`btn-anim px-4 py-2 rounded-[12px] text-[16px] font-medium transition-colors ${
            filters.status === 'offers'
          ? 'sidebar-bg text-black'
              : 'bg-[#FFFFFF0A] text-[#FFFFFF66] hover:bg-[#FFFFFF1A]'
          }`}
        >
          Offers
        </button>
      </div>
    </div>

    {/* Tags */}
<div>
  <h3 className="text-[#C8C8C8] font-medium mb-3 text-[14px]">Tags</h3>
  <div className="flex flex-wrap gap-2">
    {['Grail', 'Open to Offers', 'Open to Trade'].map((tag) => (
      <button
        key={tag}
onClick={() => {
  const newTags = filters.selectedTags.includes(tag)
    ? filters.selectedTags.filter(t => t !== tag)
    : [...filters.selectedTags, tag];
  setFilters({...filters, selectedTags: newTags});
}}
        className={`btn-anim px-3 py-1.5 rounded-[12px] text-[14px] font-medium transition-colors ${
filters.selectedTags?.includes(tag)
            ? 'sidebar-bg text-black'
            : 'bg-[#FFFFFF0A] text-[#FFFFFF66] hover:bg-[#FFFFFF1A]'
        }`}
      >
        {tag}
      </button>
    ))}
  </div>
</div>

    {/* Price Range */}
<div>
  <h3 className="text-[#C8C8C8] font-medium mb-3 text-[14px]">Price Range</h3>
  <div className="relative pt-10 pb-2">
    {/* Min value tooltip */}
    <div 
      className="absolute top-0 bg-[#1C1C1C] border border-[#FFFFFF1A] text-white text-xs px-2 py-1 rounded-[8px] font-medium"
      style={{
        left: `${((filters.priceMin - 0) / 400) * 100}%`,
        transform: 'translateX(-50%)'
      }}
    >
      ${filters.priceMin}
      {/* Down arrow */}
      <div className="absolute left-1/2 -bottom-1 transform -translate-x-1/2 w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-[#1C1C1C]"></div>
    </div>
    
    {/* Max value tooltip */}
    <div 
      className="absolute top-0 bg-[#1C1C1C] border border-[#FFFFFF1A] text-white text-xs px-2 py-1 rounded-[8px] font-medium"
      style={{
        left: `${((filters.priceMax - 0) / 400) * 100}%`,
        transform: 'translateX(-50%)'
      }}
    >
      ${filters.priceMax}
      {/* Down arrow */}
      <div className="absolute left-1/2 -bottom-1 transform -translate-x-1/2 w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-[#1C1C1C]"></div>
    </div>

    {/* Track background */}
    <div className="relative h-1 bg-[#FFFFFF1A] rounded-lg">
      {/* Active track */}
      <div 
        className="absolute h-1 bg-[#2BD383] rounded-lg"
        style={{
          left: `${((filters.priceMin - 0) / 400) * 100}%`,
          right: `${100 - ((filters.priceMax - 0) / 400) * 100}%`
        }}
      />
    </div>

    {/* Min range input */}
    <input
      type="range"
      min="0"
      max="400"
      value={filters.priceMin}
      onChange={(e) => {
        const value = Math.min(Number(e.target.value), filters.priceMax - 10);
        setFilters({...filters, priceMin: value});
      }}
      className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2BD383] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#2BD383] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
      style={{ top: '35px' }}
    />

    {/* Max range input */}
    <input
      type="range"
      min="0"
      max="400"
      value={filters.priceMax}
      onChange={(e) => {
        const value = Math.max(Number(e.target.value), filters.priceMin + 10);
        setFilters({...filters, priceMax: value});
      }}
      className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2BD383] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#2BD383] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
      style={{ top: '35px' }}
    />
  </div>
</div>

    {/* Grade */}
    <div>
      <h3 className="text-[#C8C8C8] font-medium mb-3 text-[14px]">Grade</h3>
      <div className="relative">
        <select className="w-full px-3 py-2 bg-[#FFFFFF0A] rounded-[12px] text-[#FFFFFF66] hover:bg-[#FFFFFF1A] outline-none appearance-none cursor-pointer ">
          <option>Beckett</option>
        </select>
        <FiChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>

    {/* Year */}
<div>
  <h3 className="text-[#C8C8C8] font-medium mb-3 text-[14px]">Year</h3>
  <div className="flex items-center gap-3">
    <input
      type="number"       max={4}
      placeholder="YYYY"
      value={filters.year.min}
      onChange={(e) => setFilters({...filters, year: {...filters.year, min: e.target.value}})}
      maxLength="4"
      className="w-full px-3 py-2 bg-[#FFFFFF0A] rounded-[12px] text-[#FFFFFF66] hover:bg-[#FFFFFF1A] outline-none appearance-none cursor-pointer"
    />
    <span className="text-gray-500">-</span>
    <input
      type="number"
      max={4}
      placeholder="YYYY"
      value={filters.year.max}
      onChange={(e) => setFilters({...filters, year: {...filters.year, max: e.target.value}})}
      maxLength="4"
      className="w-full px-3 py-2 bg-[#FFFFFF0A] rounded-[12px] text-[#FFFFFF66] hover:bg-[#FFFFFF1A] outline-none appearance-none cursor-pointer"
    />
  </div>
</div>

    {/* Insured Value */}
<div>
  <h3 className="text-[#C8C8C8] font-medium mb-3 text-[14px]">Insured Value</h3>
  <div className="relative pt-10 pb-2">
    {/* Min value tooltip */}
    <div 
      className="absolute top-0 bg-[#1C1C1C] border border-[#FFFFFF1A] text-white text-xs px-2 py-1 rounded-[8px] font-medium"
      style={{
        left: `${((filters.insuredMin - 0) / 400) * 100}%`,
        transform: 'translateX(-50%)'
      }}
    >
      ${filters.insuredMin}
      {/* Down arrow */}
      <div className="absolute left-1/2 -bottom-1 transform -translate-x-1/2 w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-[#1C1C1C]"></div>
    </div>
    
    {/* Max value tooltip */}
    <div 
      className="absolute top-0 bg-[#1C1C1C] border border-[#FFFFFF1A] text-white text-xs px-2 py-1 rounded-[8px] font-medium"
      style={{
        left: `${((filters.insuredMax - 0) / 400) * 100}%`,
        transform: 'translateX(-50%)'
      }}
    >
      ${filters.insuredMax}
      {/* Down arrow */}
      <div className="absolute left-1/2 -bottom-1 transform -translate-x-1/2 w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-[#1C1C1C]"></div>
    </div>

    {/* Track background */}
    <div className="relative h-1 bg-[#FFFFFF1A] rounded-lg">
      {/* Active track */}
      <div 
        className="absolute h-1 bg-[#2BD383] rounded-lg"
        style={{
          left: `${((filters.insuredMin - 0) / 400) * 100}%`,
          right: `${100 - ((filters.insuredMax - 0) / 400) * 100}%`
        }}
      />
    </div>

    {/* Min range input */}
    <input
      type="range"
      min="0"
      max="400"
      value={filters.insuredMin}
      onChange={(e) => {
        const value = Math.min(Number(e.target.value), filters.insuredMax - 10);
        setFilters({...filters, insuredMin: value});
      }}
      className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2BD383] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#2BD383] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
      style={{ top: '35px' }}
    />

    {/* Max range input */}
    <input
      type="range"
      min="0"
      max="400"
      value={filters.insuredMax}
      onChange={(e) => {
        const value = Math.max(Number(e.target.value), filters.insuredMin + 10);
        setFilters({...filters, insuredMax: value});
      }}
      className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2BD383] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#2BD383] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
      style={{ top: '35px' }}
    />
  </div>
</div>

    {/* Owner */}
    <div>
      <h3 className="text-[#C8C8C8] font-medium mb-3 text-[14px]">Owner</h3>
      <input
        type="text"
        placeholder="Enter Owner Address"
      className="w-full px-3 py-2 bg-[#FFFFFF0A] rounded-[12px] text-[#FFFFFF66] hover:bg-[#FFFFFF1A] outline-none appearance-none cursor-pointer"
      />
    </div>

    {/* Checkboxes */}
    <div className="space-y-3 flex flex-col">
      <label className="flex items-center  gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={filters.authenticated}
          onChange={(e) => setFilters({...filters, authenticated: e.target.checked})}
     className="w-4 h-4  cursor-pointer"
        />
        <span className="text-[#C8C8C8] font-medium  text-[14px]">Autographed</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={filters.anonymized}
          onChange={(e) => setFilters({...filters, anonymized: e.target.checked})}
          className="w-4 h-4 rounded accent-[#2BD383]"
        />
        <span className="text-[#C8C8C8] font-medium  text-[14px]">Authenticated</span>
      </label>
    </div>
  </div>
</Reveal>

          {/* Main Content */}
          <div className="flex-1">


            {/* Cards Grid */}
            <div className="grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4 mb-8">
              {currentCards.map((card, index) => (
                <Reveal key={`${currentPage}-${card.id}`} className="h-full relative hover:z-20" y={30} delay={index * 70}><Card card={card} onBuyClick={handleBuyClick} /></Reveal>
              ))}
            </div>

            {/* Pagination */}
            <Reveal y={20} delay={120}>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              totalItems={allCards.length}
              itemsPerPage={cardsPerPage}
            />
            </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}