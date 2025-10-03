"use client";

import { useState } from 'react';
import Pagination from '../components/Pagination';

export default function LeaderboardSection() {
  const [activeTab, setActiveTab] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 7; // Showing 7 items (ranks 4-10 in view)

  // Dummy leaderboard data
  const leaderboardData = [
    {
      rank: 1,
      username: "Coud",
      year: "2019",
      walletAddress: "9rYH23P8RLuQmQ7q4RewCn9h2KD6BF3nGxHqBZ87C",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 15
    },
    {
      rank: 2,
      username: "Coud",
      year: "2019",
      walletAddress: "2sVY719FHVKeKN8InrbJQxvI7cFhHF9st2R2GxVJK8TB",
      primaryPoints: "5,982,450",
      totalPoints: "9,111,230",
      bonusPoints: "9,111,230",
      referrals: 20
    },
    {
      rank: 3,
      username: "Coud",
      year: "2019",
      walletAddress: "5eHr469HbPzLmX2S5dQvTn5sl7Qb3K4ZHnG7Y82Q",
      primaryPoints: "5,982,450",
      totalPoints: "11,457,892",
      bonusPoints: "11,457,892",
      referrals: 34
    },
    {
      rank: 4,
      username: "Player4",
      year: "2020",
      walletAddress: "8KGF934MjlyPJQbNBl1Cx1vBz5sc3Hl4RK3Fqt1YW8V9QK",
      primaryPoints: "5,982,450",
      totalPoints: "6,246,678",
      bonusPoints: "6,246,678",
      referrals: 14
    },
    {
      rank: 5,
      username: "Player5",
      year: "2020",
      walletAddress: "3wQ2B8RhQyRqTgV5RROoCcpBJ6JJb7k9HkWqTHK5J",
      primaryPoints: "5,982,450",
      totalPoints: "10,423,456",
      bonusPoints: "10,423,456",
      referrals: 6
    },
    {
      rank: 6,
      username: "Player6",
      year: "2020",
      walletAddress: "6tAWF9OUqQxYHNpC3mJHWb9s2GLJzB2F7lNYgX4T4W",
      primaryPoints: "5,982,450",
      totalPoints: "7,890,123",
      bonusPoints: "7,890,123",
      referrals: 12
    },
    {
      rank: 7,
      username: "Player7",
      year: "2020",
      walletAddress: "1u2H647JcLxJtQmQ6kP8BnK9h3FQmT4M8BQwZ4P2P8V",
      primaryPoints: "5,982,450",
      totalPoints: "18,234,567",
      bonusPoints: "18,234,567",
      referrals: 18
    },
    {
      rank: 8,
      username: "Player8",
      year: "2021",
      walletAddress: "4mK9P23L8TyVn5QaRt7BwEh2PxK6NfG3HsY9ZcW1D",
      primaryPoints: "5,982,450",
      totalPoints: "5,123,456",
      bonusPoints: "5,123,456",
      referrals: 8
    },
    {
      rank: 9,
      username: "Player9",
      year: "2021",
      walletAddress: "7eQw3R8YtKpL2MnB5VgH9JxC6FnT4DsA1ZkW8PqO",
      primaryPoints: "5,982,450",
      totalPoints: "4,567,890",
      bonusPoints: "4,567,890",
      referrals: 5
    },
    {
      rank: 10,
      username: "Player10",
      year: "2021",
      walletAddress: "9aB7C5D2E8F1G3H6I4J9K2L7M5N8O1P6Q3R9S4T2",
      primaryPoints: "5,982,450",
      totalPoints: "3,890,234",
      bonusPoints: "3,890,234",
      referrals: 3
    },
  ];

  const totalPages = Math.ceil(leaderboardData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentData = leaderboardData.slice(startIndex, endIndex);

  // Get top 3 for podium
  const topThree = leaderboardData.slice(0, 3);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  return (
    <section
      className="relative w-full min-h-screen lg:py-16 md:py-12 py-8 lg:px-8 md:px-6 px-4 bg-black"
      id="leaderboard"
    >
      <div className="max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-white lg:text-4xl md:text-3xl text-2xl font-bold">
            Leaderboard
          </h1>

          {/* Tab Selector */}
          <div className="flex gap-2 bg-gray-900 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'all'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              All Packs
            </button>
            <button
              onClick={() => setActiveTab('elite')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'elite'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Elite Packs
            </button>
            <button
              onClick={() => setActiveTab('legendary')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'legendary'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Legendary Packs
            </button>
          </div>
        </div>

        {/* Podium - Top 3 */}
        <div className="flex items-end justify-center gap-8 mb-16 relative">
          {/* 2nd Place */}
          <div className="flex flex-col items-center">
            <div className="relative mb-4">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 p-1">
                <div className="w-full h-full rounded-full bg-gradient-to-br from-blue-400 via-purple-400 to-pink-400 flex items-center justify-center">
                  <span className="text-white text-2xl">🏆</span>
                </div>
              </div>
              <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-gray-700 text-white text-xs px-2 py-1 rounded-full font-bold">
                2
              </div>
            </div>
            <div className="text-white font-bold mb-1">{topThree[1]?.username}</div>
            <div className="text-gray-500 text-xs mb-2">{topThree[1]?.year}</div>
            <div className="flex items-center gap-1 text-emerald-400 text-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
              {topThree[1]?.totalPoints}
            </div>
            {/* Silver Pedestal */}
            <div className="w-32 h-32 bg-gradient-to-b from-gray-300 to-gray-500 rounded-t-xl mt-4 flex items-center justify-center relative">
              <span className="text-gray-600 text-6xl font-bold">2</span>
            </div>
          </div>

          {/* 1st Place */}
          <div className="flex flex-col items-center -mt-8">
            <div className="relative mb-4">
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 p-1">
                <div className="w-full h-full rounded-full bg-gradient-to-br from-blue-400 via-purple-400 to-pink-400 flex items-center justify-center">
                  <span className="text-white text-4xl">👑</span>
                </div>
              </div>
              <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-black text-xs px-2 py-1 rounded-full font-bold">
                1
              </div>
            </div>
            <div className="text-white font-bold mb-1 text-lg">{topThree[0]?.username}</div>
            <div className="text-gray-500 text-xs mb-2">{topThree[0]?.year}</div>
            <div className="flex items-center gap-1 text-emerald-400 text-base">
              <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
              {topThree[0]?.totalPoints}
            </div>
            {/* Gold Pedestal */}
            <div className="w-40 h-40 bg-gradient-to-b from-yellow-300 to-yellow-600 rounded-t-xl mt-4 flex items-center justify-center relative">
              <span className="text-yellow-800 text-7xl font-bold">1</span>
            </div>
          </div>

          {/* 3rd Place */}
          <div className="flex flex-col items-center">
            <div className="relative mb-4">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 p-1">
                <div className="w-full h-full rounded-full bg-gradient-to-br from-blue-400 via-purple-400 to-pink-400 flex items-center justify-center">
                  <span className="text-white text-2xl">🥉</span>
                </div>
              </div>
              <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-orange-600 text-white text-xs px-2 py-1 rounded-full font-bold">
                3
              </div>
            </div>
            <div className="text-white font-bold mb-1">{topThree[2]?.username}</div>
            <div className="text-gray-500 text-xs mb-2">{topThree[2]?.year}</div>
            <div className="flex items-center gap-1 text-emerald-400 text-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
              {topThree[2]?.totalPoints}
            </div>
            {/* Bronze Pedestal */}
            <div className="w-32 h-28 bg-gradient-to-b from-orange-400 to-orange-700 rounded-t-xl mt-4 flex items-center justify-center relative">
              <span className="text-orange-900 text-6xl font-bold">3</span>
            </div>
          </div>
        </div>

        {/* Leaderboard Table */}
        <div className="bg-gray-900/30 rounded-xl border border-gray-800 overflow-hidden mb-8">
          {/* Table Header */}
          <div className="grid grid-cols-7 gap-4 px-6 py-4 bg-gray-900/50 border-b border-gray-800 text-gray-400 text-sm font-medium">
            <div>Rank</div>
            <div>Wallet Address</div>
            <div className="text-center">Primary Points</div>
            <div className="text-center">Total Points</div>
            <div className="text-center">Bonus Points</div>
            <div className="text-center">Referrals</div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-gray-800">
            {currentData.map((player) => (
              <div
                key={player.rank}
                className="grid grid-cols-7 gap-4 px-6 py-4 hover:bg-gray-800/30 transition-colors items-center"
              >
                <div className="text-white font-medium">{player.rank}</div>
                <div className="text-gray-400 text-sm truncate font-mono">
                  {player.walletAddress}
                </div>
                <div className="flex items-center justify-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                  <span className="text-white text-sm">{player.primaryPoints}</span>
                </div>
                <div className="text-white text-sm text-center">{player.totalPoints}</div>
                <div className="text-white text-sm text-center">{player.bonusPoints}</div>
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 rounded bg-emerald-600/20 flex items-center justify-center">
                    <span className="text-emerald-400 text-xs">👥</span>
                  </div>
                  <span className="text-emerald-400 text-sm">{player.referrals}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pagination */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          totalItems={leaderboardData.length}
          itemsPerPage={itemsPerPage}
        />
      </div>
    </section>
  );
}