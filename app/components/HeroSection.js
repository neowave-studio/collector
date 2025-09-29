"use client";

import { useState } from 'react';

export default function GachaHeroSection() {
  const [turboMode, setTurboMode] = useState(false);

  return (
    <section 
      className="relative  w-full bg-black lg:pt-28 md:pt-24 pt-20 lg:pb-12 md:pb-10 pb-8 lg:px-8 md:px-6 px-4" 
      id="gacha"
    >
      <div className="max-w-[1400px] mx-auto">
        <div className="grid lg:grid-cols-2 grid-cols-1 gap-8 items-start">
          
          {/* Left Side - Pack Image */}
          <div className="relative">
            {/* Tab Selector */}
            <div className="flex gap-2 mb-6">
              <button className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors">
                PKMN 50
              </button>
              <button className="px-4 py-2 bg-transparent text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors border border-gray-700">
                PKMN 250
              </button>
            </div>

            {/* Pack Image Container */}
            <div className="relative bg-gradient-to-br from-gray-900 to-black rounded-2xl p-8 border border-gray-800">
              {/* Placeholder for the pack image */}
              <div className="aspect-square bg-gradient-to-br from-purple-900/30 via-yellow-900/30 to-blue-900/30 rounded-xl flex items-center justify-center relative overflow-hidden">
                {/* Animated background effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/20 via-purple-500/20 to-blue-500/20 animate-pulse"></div>
                
                {/* Center Pokemon silhouette placeholder */}
                <div className="relative z-10 text-center">
                  <div className="w-64 h-64 mx-auto bg-yellow-400/20 rounded-full flex items-center justify-center">
                    <span className="text-yellow-300 text-6xl font-bold">⚡</span>
                  </div>
                  <p className="text-white mt-4 text-lg font-semibold">Elite Pokémon Pack</p>
                </div>

                {/* Decorative elements */}
                <div className="absolute top-4 left-4 text-white/60 text-sm">
                  <div className="writing-mode-vertical-rl">ピカチュウ</div>
                </div>
              </div>

              {/* Sparkle effects at bottom */}
              <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2 flex gap-2">
                {[...Array(8)].map((_, i) => (
                  <div 
                    key={i}
                    className="w-8 h-8 bg-white/20 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  ></div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Side - Pack Details */}
          <div className="space-y-6">
            {/* Header with Badge */}
            <div className="flex items-start justify-between">
              <div>
                <div className="inline-block px-3 py-1 bg-yellow-500/20 border border-yellow-500/50 rounded text-yellow-400 text-xs font-bold mb-3">
                  A+ Guaranteed Authenticity
                </div>
                <h1 className="text-white lg:text-4xl md:text-3xl text-2xl font-bold">
                  Elite Pokémon Gacha Pack
                </h1>
              </div>
              
              {/* Expected Value */}
              <div className="text-right">
                <p className="text-gray-400 text-xs mb-1">Expected value</p>
                <div className="flex items-center gap-2 justify-end">
                  <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                  <span className="text-white text-2xl font-bold">2,600.00</span>
                </div>
              </div>
            </div>
<div className='flex w-full gap-2'>
            {/* Turbo Mode Toggle */}
            <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold mb-1">Turbo Mode</h3>
                  <p className="text-gray-400 text-sm">
                    This automatically sells back any common card and hunts grails at maximum speed.
                  </p>
                </div>
                <button
                  onClick={() => setTurboMode(!turboMode)}
                  className={`relative w-14 h-8 rounded-full transition-colors ${
                    turboMode ? 'bg-emerald-600' : 'bg-gray-700'
                  }`}
                >
                  <div
                    className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform ${
                      turboMode ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  ></div>
                </button>
              </div>
            </div>

            {/* Free Packs Left */}
              <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold mb-1">Free Packs</h3>
                  <p className="text-gray-400 text-sm">
                   ---
                  </p>
                </div>

              </div>
            </div></div>

            {/* Pack Information Grid */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-gray-400 text-sm mb-1">Pack Content</p>
                <p className="text-white font-semibold">1 Card</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">Instant Buyback Offer</p>
                <p className="text-white font-semibold">85%</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-1">Big Win Chance</p>
                <p className="text-white font-semibold">20%</p>
              </div>
            </div>

            {/* Stats Section */}
            <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
              <h3 className="text-white font-semibold mb-4">Stats</h3>
              
              {/* Progress Bar */}
              <div className="relative h-8 bg-gray-800 rounded-lg overflow-hidden mb-4">
                <div className="absolute inset-0 flex">
                  <div className="bg-gray-600 h-full" style={{ width: '80%' }}></div>
                  <div className="bg-blue-600 h-full" style={{ width: '15%' }}></div>
                  <div className="bg-yellow-600 h-full" style={{ width: '4%' }}></div>
                  <div className="bg-purple-600 h-full" style={{ width: '1%' }}></div>
                </div>
              </div>

              {/* Rarity List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-gray-600"></div>
                    <span className="text-gray-300">Common</span>
                  </div>
                  <span className="text-gray-400">($30 - $60, 80% chance)</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-600"></div>
                    <span className="text-gray-300">Uncommon</span>
                  </div>
                  <span className="text-gray-400">($60 - $110, 15% chance)</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-600"></div>
                    <span className="text-gray-300">Rare</span>
                  </div>
                  <span className="text-gray-400">($110 - $250, 4% chance)</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-purple-600"></div>
                    <span className="text-gray-300">Epic</span>
                  </div>
                  <span className="text-gray-400">($250 - $2,000+, 1% chance)</span>
                </div>
              </div>
            </div>

            {/* Open Pack Button */}
            <button className="w-full py-4 bg-gray-800 hover:bg-gray-700 text-gray-500 rounded-xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-2 border border-gray-700">
              Sign in to open 🔒
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}