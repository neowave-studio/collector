"use client";

import { useState } from 'react';
import Image from 'next/image';
import Reveal from './Reveal';

export default function SingleCardSection() {
  const [turboMode, setTurboMode] = useState(false);
  const packs = [
    { id: "PKMN 50", label: "PKMN 50", value: 50 },
    { id: "PKMN 250", label: "PKMN 250", value: 250 }
  ];
  const [selectedPack, setSelectedPack] = useState("PKMN 50");
  const [activeTab, setActiveTab] = useState('buy-now');

  return (
    <section 
      className="relative pt-[80px] font-sf-pro-rounded md:pt-[140px] lg:pt-[200px] w-full bg-black lg:pb-12 md:pb-10 pb-8 lg:px-8 md:px-6 px-4" 
      id="gacha"
    >
      <div className="max-w-[1400px] mx-auto">
        <div className="grid lg:grid-cols-2 grid-cols-1 gap-6 md:gap-8 items-start">
          
          {/* Left Side - Pack Image */}
          <Reveal className="relative w-full" y={34} delay={80}>
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
</Reveal>

          {/* Right Side - Pack Details */}
          <div className="space-y-4 md:space-y-6 w-full">
            {/* Header with Badge */}
            <Reveal className="flex flex-col sm:flex-row items-start justify-between gap-3 md:gap-0" y={26} delay={160}>
              <div className="flex-1">
                <div className="mb-3 flex items-center gap-2">
                  <span className='inline-block px-3 py-1 md:py-0 bg-[#DBB25E]/20 border border-[#DBB25E] rounded-lg text-[#FFCA61] text-[12px] md:text-[14px] font-bold rarity-a'>
                    A+
                  </span>
        
                </div>

                <h1 className="text-white text-[20px] md:text-[24px] flex gap-3 font-bold">
               2006 Celebi Gold Star – EX Crystal Guardians <span className='text-[#FFFFFF99] text-[12px] md:text-[14px] font-[400]'>2019</span>
                </h1>
                           <h1 className="text-[#FFFFFF80] text-[14px] md:text-[16px] items-center flex gap-3 font-[500]">
         Owned by: <span className='text-white text-[14px] md:text-[16px] font-[500]'>(0xa...42148f)</span>
                </h1>
              </div>


            </Reveal>
<Reveal className="flex gap-4 " y={24} delay={240}>
  <button
    onClick={() => setActiveTab('buy-now')}
    className={` px-3 tab-button ${activeTab === 'buy-now' ? 'active border-b border-white' : ''}`}
  >
    Buy Now
  </button>
  <button 
    onClick={() => setActiveTab('vault')}
    className={`px-3 tab-button ${activeTab === 'vault' ? 'active border-b border-white' : ''}`}
  >
    Vault
  </button>
  <button 
    onClick={() => setActiveTab('contract')}
    className={`px-3 tab-button ${activeTab === 'contract' ? 'active border-b border-white' : ''}`}
  >
    Contract
  </button>
</Reveal>
  {/* Card Details Grid */}
  <Reveal className="grid grid-cols-2 gap-y-3 text-[14px] md:text-[16px]" y={24} delay={320}>
    <div className="text-[#FFFFFF80]">Grading Company</div>
    <div className="text-[#FFFFFFE5] text-[14px] text-right font-medium">PSA</div>
    
    <div className="text-[#FFFFFF99] font-medium text-[14px]  ">Grading ID</div>
    <div className="text-[#FFFFFFE5] text-[14px] text-right font-medium">5303459309</div>
    
    <div className="text-[#FFFFFF99] font-medium text-[14px]  ">Grade</div>
    <div className="text-[#FFFFFFE5] text-[14px] text-right font-medium">GEM-MT 10</div>
    
    <div className="text-[#FFFFFF99] font-medium text-[14px]  ">Generic Grade</div>
    <div className="text-[#FFFFFFE5] text-[14px] text-right font-medium">10</div>
    
    <div className="text-[#FFFFFF99] font-medium text-[14px]  ">Authenticated</div>
    <div className="text-[#FFFFFFE5] text-[14px] text-right font-medium">Yes</div>
  </Reveal>
  {/* Asking Price */}
  <Reveal className="mt-6" y={24} delay={400}>
    <div className="text-[#FFFFFF99] text-[16px] font-medium mb-2">Asking Price</div>
    <div className="flex items-center gap-2">
      <img src="/coin.svg" alt="coin" className="w-[24px] mt-1 h-[24px]" />
      <span className="text-white text-[22px] md:text-[24px] font-bold">2,600.00</span>
    </div>
  </Reveal>

  {/* Action Buttons */}
  <Reveal className="flex gap-3 mt-6" y={22} delay={480}>
<button
  onClick={(e) => {
    e.stopPropagation(); // Prevent card click when clicking button
    onBuyClick && onBuyClick(card);
  }}
  className="buy-now-button w-1/2 rounded-[16px] border px-3 py-4 border-[#FFFFFF1A] font-[600] text-[16px] leading-[100%] tracking-[-3%] duration-300 flex items-center justify-center gap-2"
>
  <span className="buy-now-button-text">Buy Now</span>
  <Image src="/lock.svg" alt="lock" width={18} height={18} />
</button>
    
<button className="make-offer-button flex-1 text-white text-[16px] font-semibold py-3 rounded-[16px] flex items-center justify-center gap-2 transition-colors hover:opacity-90">
  Make an offer

    <Image src="/pig.svg" alt="lock" width={18} height={18} />
</button>
  </Reveal>
  {/* Verified Badge */}
  <Reveal className="flex items-center gap-2 mt-4" y={20} delay={540}>
    <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center">

    </div>
    <span className="text-white text-[16px] font-bold">Verified by BGS</span>
  </Reveal>
  <Reveal className="space-y-3 mt-6" y={20} delay={600}>
    <button className="w-full flex items-center justify-between p-4  border-b border-[#FFFFFF1A] rounded-[12px] hover:bg-[#252525] transition-colors hover-glow">
      <span className="text-white text-[16px] font-bold">Activities</span>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M6 8L10 12L14 8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
    
    <button className="w-full flex items-center justify-between p-4  border-b border-[#FFFFFF1A] rounded-[12px] hover:bg-[#252525] transition-colors hover-glow">
      <span className="text-white text-[16px] font-bold">Offers</span>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M6 8L10 12L14 8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  </Reveal>

          </div>
        </div>
      </div>
    </section>
  );
}