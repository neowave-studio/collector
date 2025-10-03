"use client";

import { useState } from 'react';
import Image from 'next/image';

export default function GachaHeroSection() {
  const [turboMode, setTurboMode] = useState(false);
  const packs = [
    { id: "PKMN 50", label: "PKMN 50", value: 50 },
    { id: "PKMN 250", label: "PKMN 250", value: 250 }
  ];
  const [selectedPack, setSelectedPack] = useState("PKMN 50");

  return (
    <section 
      className="relative pt-[80px] md:pt-[140px] lg:pt-[200px] w-full bg-black lg:pb-12 md:pb-10 pb-8 lg:px-8 md:px-6 px-4" 
      id="gacha"
    >
      <div className="max-w-[1400px] mx-auto">
        <div className="grid lg:grid-cols-2 grid-cols-1 gap-6 md:gap-8 items-start">
          
          {/* Left Side - Pack Image */}
          <div className="relative w-full">
            {/* Pack Image Container */}
            <div 
              className="relative rounded-2xl p-6 md:p-8 border border-gray-800 bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: "url('/productcontainer.png')" }}
            >
              {/* Product Image in Center */}
              <div className="aspect-square flex items-center justify-center relative overflow-hidden">
                <img 
                  src="/productimage.png" 
                  alt="Pokemon Pack" 
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
            
            {/* Pack Selection Buttons */}
  <div className="flex gap-4 mt-6">
      {packs.map((pack) => (
        <button
          key={pack.id}
          onClick={() => setSelectedPack(pack.id)}
          className={`pack-button flex items-center rounded-[16px] justify-center gap-3 md:gap-5 px-3 py-2 pl-2 text-[12px] md:text-[16px] font-medium transition-all ${
            selectedPack === pack.id
              ? "nav-active text-[#FFFFFF]"
              : "border border-[#FFFFFF]/20 bg-transparent text-[#FFFFFF]/40"
          }`}
        >
          <div
            className={`rounded-[12px] p-3 ${
              selectedPack === pack.id
                ? "border border-[#FFFFFF]/23 bg-[#FFFFFF]/12"
                : "border border-transparent bg-[#FFFFFF]/12"
            }`}
          >
            <img
              src="/productimage.png"
              className="md:w-10 w-5 h-5 md:h-10"
              alt="Pokemon Pack"
            />
          </div>
          {pack.label}
        </button>
      ))}
    </div>
</div>

          {/* Right Side - Pack Details */}
          <div className="space-y-4 md:space-y-6 w-full">
            {/* Header with Badge */}
            <div className="flex flex-col sm:flex-row items-start justify-between gap-3 md:gap-0">
              <div className="flex-1">
                <div className="mb-3 flex items-center gap-2">
                  <span className='inline-block px-3 py-1 md:py-0 bg-[#DBB25E]/20 border border-[#DBB25E] rounded-lg text-[#FFCA61] text-[12px] md:text-[14px] font-bold rarity-a'>
                    A+
                  </span>
                  <span className='text-[#FFFFFF]/60 font-medium text-[12px] md:text-[14px]'>
                    Guaranteed Authenticity
                  </span>
                </div>

                <h1 className="text-white text-[20px] md:text-[24px] font-bold">
                  Elite Pokemon Gacha Pack
                </h1>
              </div>
              
              {/* Expected Value */}
              <div className="text-left sm:text-right w-full sm:w-auto">
                <p className="text-[#FFFFFF]/60 font-medium text-[12px] md:text-[14px] mb-1 md:mb-2">
                  Expected value
                </p>
                <div className="flex items-center gap-2 sm:justify-end">
                  <Image className='mt-1' src="/coin.svg" alt="coin" width={20} height={20} />
                  <span className="text-white text-[16px] md:text-[18px] font-medium">2,600.00</span>
                </div>
              </div>
            </div>

            {/* Turbo Mode and Free Packs */}
            <div className="flex flex-col md:flex-row w-full gap-3 md:gap-4">
              {/* Turbo Mode Toggle */}
              <div className="bg-[#FFFFFF]/4 rounded-[16px] p-4 md:p-5 border border-[#FFFFFF]/11 flex-1">
                <div className="flex items-center justify-between gap-3 md:gap-4">
                  <div className="flex-1">
                    <h3 className="text-white font-bold text-[14px] md:text-[16px] mb-1 md:mb-2">
                      Turbo Mode
                    </h3>
                    <p className="text-[#FFFFFF]/60 font-medium text-[12px] md:text-[14px] leading-[140%]">
                      This automatically sells back any common card and hunts grails at maximum speed.
                    </p>
                  </div>
                  <button
                    onClick={() => setTurboMode(!turboMode)}
                    className={`relative w-[52px] h-[28px] transition-colors rounded-[120px] flex-shrink-0 ${
                      turboMode ? 'bg-[#41785C]' : 'bg-[#333333]'
                    }`}
                  >
                    <div
                      className={`absolute top-[2px] w-[24px] h-[24px] bg-white border border-white/28 rounded-full transition-transform ${
                        turboMode ? 'translate-x-[26px]' : 'translate-x-[2px]'
                      }`}
                    ></div>
                  </button>
                </div>
              </div>

              {/* Free Packs Left */}
              <div className="bg-[#FFFFFF]/4 rounded-[16px] p-4 md:p-5 border border-[#FFFFFF]/11 md:w-[220px]">
                <div>
                  <h3 className="text-white/60 font-medium text-[12px] md:text-[14px] mb-1 md:mb-2">
                    Free Packs Left
                  </h3>
                  <p className="text-white text-[12px] md:text-[14px]">_</p>
                </div>
              </div>
            </div>

            {/* Pack Information Grid */}
            <div className="grid grid-cols-3 gap-3 md:gap-4">
              <div>
                <p className="text-[#FFFFFF]/60 text-[12px] md:text-[14px] font-medium mb-1">
                  Pack Content
                </p>
                <p className="text-white font-medium text-[16px] md:text-[18px]">1 Card</p>
              </div>
              <div>
                <p className="text-[#FFFFFF]/60 text-[12px] md:text-[14px] font-medium mb-1">
                  Instant Buyback Offer
                </p>
                <p className="text-white font-medium text-[16px] md:text-[18px]">85%</p>
              </div>
              <div>
                <p className="text-[#FFFFFF]/60 text-[12px] md:text-[14px] font-medium mb-1">
                  Big Win Chance
                </p>
                <p className="text-white font-medium text-[16px] md:text-[18px]">20%</p>
              </div>
            </div>

            {/* Stats Section */}
            <div className="bg-[#0A0A0A] rounded-[16px] p-4 md:p-5 border border-[#FFFFFF]/10">
              <h3 className="text-white/60 font-regular text-[12px] md:text-[14px] mb-3 md:mb-4">
                Stats
              </h3>
              
              {/* Progress Bar */}
              <div className="relative h-3 md:h-4 bg-[#1A1A1A] rounded-lg overflow-hidden mb-3 md:mb-4">
                <div className="absolute inset-0 flex">
                  <div className="bg-[#666666] h-full" style={{ width: '80%' }}></div>
                  <div className="bg-[#6B8AFF] h-full" style={{ width: '0%' }}></div>
                  <div className="bg-[#FFD700] h-full" style={{ width: '0%' }}></div>
                  <div className="bg-[#B57BFF] h-full" style={{ width: '20%' }}></div>
                </div>
              </div>

              {/* Rarity List */}
              <div className="space-y-2 md:space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-[#666666]"></div>
                    <span className="text-white/90 font-medium text-[12px] md:text-[14px]">
                      Common
                    </span>
                  </div>
                  <span className="text-white/60 font-medium text-[11px] md:text-[14px]">
                    ($30 - $60, 80% chance)
                  </span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-[#6B8AFF]"></div>
                    <span className="text-white text-[12px] md:text-[14px]">Uncommon</span>
                  </div>
                  <span className="text-[#C8C8C8] text-[11px] md:text-[14px]">
                    ($60 - $110, 15% chance)
                  </span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-[#FFD700]"></div>
                    <span className="text-white text-[12px] md:text-[14px]">Rare</span>
                  </div>
                  <span className="text-[#C8C8C8] text-[11px] md:text-[14px]">
                    ($110 - $250, 4% chance)
                  </span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-[#2BD383]"></div>
                    <span className="text-white text-[12px] md:text-[14px]">Epic</span>
                  </div>
                  <span className="text-[#C8C8C8] text-[11px] md:text-[14px]">
                    ($250 - $2,000+, 1% chance)
                  </span>
                </div>
              </div>
            </div>

            {/* Open Pack Button */}
            <button className="w-full p-[10px] md:p-[12px] bg-[#000000]/39 hover:bg-[#141414] signin-button text-white/20 rounded-[16px] font-semibold text-[14px] md:text-[16px] transition-all duration-300 flex items-center justify-center gap-2">
              Sign in to open 🔒
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}