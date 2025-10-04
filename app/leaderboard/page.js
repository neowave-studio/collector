"use client";

import { useState } from 'react';
import Pagination from '../components/Pagination';

export default function LeaderboardSection() {
  const [activeTab, setActiveTab] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 7;

  // Dummy leaderboard data with avatars
  const leaderboardData = [
    {
      rank: 1,
      username: "Cloud",
      walletAddress: "0x7e...2C",
      fullWallet: "9rYH23P8RLuQmQ7q4RewCn9h2KD6BF3nGxHqBZ87C",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 18,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Cloud1"
    },
    {
      rank: 2,
      username: "Cloud",
      walletAddress: "0x7e...2C",
      fullWallet: "2sVY719FHVKeKN8InrbJQxvI7cFhHF9st2R2GxVJK8TB",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 18,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Cloud2"
    },
    {
      rank: 3,
      username: "Cloud",
      walletAddress: "0x7e...2C",
      fullWallet: "5eHr469HbPzLmX2S5dQvTn5sl7Qb3K4ZHnG7Y82Q",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 18,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Cloud3"
    },
    {
      rank: 4,
      username: "Cloud",
      walletAddress: "0x...JQwTc7s1K8T8",
      fullWallet: "8KGF934MjlyPJQbNBl1Cx1vBz5sc3Hl4RK3Fqt1YW8V9QK",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 18,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Cloud4"
    },
    {
      rank: 5,
      username: "Cloud",
      walletAddress: "0x...JQwTc7s1K8T8",
      fullWallet: "3wQ2B8RhQyRqTgV5RROoCcpBJ6JJb7k9HkWqTHK5J",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 18,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Cloud5"
    },
    {
      rank: 6,
      username: "Cloud",
      walletAddress: "0x...JQwTc7s1K8T8",
      fullWallet: "6tAWF9OUqQxYHNpC3mJHWb9s2GLJzB2F7lNYgX4T4W",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 18,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Cloud6"
    },
    {
      rank: 7,
      username: "Cloud",
      walletAddress: "0x...JQwTc7s1K8T8",
      fullWallet: "1u2H647JcLxJtQmQ6kP8BnK9h3FQmT4M8BQwZ4P2P8V",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 18,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Cloud7"
    },
    {
      rank: 8,
      username: "Cloud",
      walletAddress: "0x...JQwTc7s1K8T8",
      fullWallet: "4mK9P23L8TyVn5QaRt7BwEh2PxK6NfG3HsY9ZcW1D",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 18,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Cloud8"
    },
    {
      rank: 9,
      username: "Cloud",
      walletAddress: "0x...JQwTc7s1K8T8",
      fullWallet: "7eQw3R8YtKpL2MnB5VgH9JxC6FnT4DsA1ZkW8PqO",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 18,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Cloud9"
    },
    {
      rank: 10,
      username: "Cloud",
      walletAddress: "0x...JQwTc7s1K8T8",
      fullWallet: "9aB7C5D2E8F1G3H6I4J9K2L7M5N8O1P6Q3R9S4T2",
      primaryPoints: "5,982,450",
      totalPoints: "5,982,450",
      bonusPoints: "5,982,450",
      referrals: 18,
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Cloud10"
    },
  ];

  const totalPages = Math.ceil(leaderboardData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentData = leaderboardData.slice(startIndex, endIndex);

  const topThree = leaderboardData.slice(0, 3);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  return (
    <section
      className="relative w-full min-h-screen lg:py-16 md:pb-12 lg:pt-[200px] py-8 lg:px-8 md:px-6 px-4 bg-black"
      id="leaderboard"
    >
      <div className="max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-white lg:text-[24px] md:text-[22px] text-[20px] font-semibold">
            Leaderboard
          </h1>

          {/* Tab Selector */}
          <div className="relative">
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value)}
              className="appearance-none bg-[#1A1A1A] text-[#FFFFFF] rounded-[16px] px-4 py-2 border border-[#333333] cursor-pointer transition-colors"
            >
              <option value="all">All packs</option>
              <option value="elite">Elite Packs</option>
              <option value="legendary">Legendary Packs</option>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
              ▼
            </div>
          </div>
        </div>

        {/* Podium - Top 3 */}
<div className="flex items-center justify-center  gap-16 mb-16 mt-32">
          {/* 2nd Place */}
          <div className="flex flex-col items-center ">
            <div className="relative mb-4">
              {/* Points at top */}
              <div className="absolute w-full -top-10 left-1/2 transform -translate-x-1/2 flex items-center gap-1 px-3 py-1.5 rounded-full">
                <img src="/coin.svg" alt="coin" className="w-[24px] mt-1 h-[24px]" />
                <span className="text-[#A7FFD5] text-[16px] font-medium">{topThree[1]?.totalPoints}</span>
              </div>
              
              <img
                src={topThree[1]?.avatar}
                alt={topThree[1]?.username}
                className="w-[130px] h-[130px] rounded-full object-cover border-2 border-[#55646F]"
              />
              <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-orange-600 text-white text-xs px-3 py-0 podium-second rounded-full font-bold">
                2
              </div>
            </div>
            <div className="text-white font-semibold text-[24px] mb-1">{topThree[1]?.username}</div>
            <div className="text-white bg-[#FFFFFF1A] border border-[#FFFFFF2E] p-1 rounded-[8px] font-medium text-[16px] mb-3">{topThree[1]?.walletAddress}</div>
          </div>

          {/* 1st Place */}
          <div className="flex flex-col items-center -mt-16 ">
            <div className="relative mb-4">
              {/* Points at top */}
              <div className="absolute  w-full -top-10 left-1/2 transform -translate-x-1/2 flex items-center gap-1 px-3 py-1.5 rounded-full">
                <img src="/coin.svg" alt="coin" className="w-[24px] mt-1 h-[24px]" />
                <span className="text-[#A7FFD5] text-[16px] font-medium">{topThree[0]?.totalPoints}</span>
              </div>
              
              <img
                src={topThree[0]?.avatar}
                alt={topThree[0]?.username}
                className="w-[130px] h-[130px] rounded-full object-cover border-2 border-[#FFCA61]"
              />
              <div className="absolute podium-first -bottom-2 left-1/2 transform -translate-x-1/2 bg-orange-600 text-white text-xs px-3 py-0 rounded-full font-bold">
                1
              </div>
            </div>
            <div className="text-white font-semibold text-[24px] mb-1">{topThree[0]?.username}</div>
            <div className="text-white bg-[#FFFFFF1A] border border-[#FFFFFF2E] p-1 rounded-[8px] font-medium text-[16px] mb-3">{topThree[0]?.walletAddress}</div>
          </div>

          {/* 3rd Place */}
          <div className="flex flex-col items-center ">
            <div className="relative mb-4">
              {/* Points at top */}
              <div className="absolute w-full -top-10 left-1/2 transform -translate-x-1/2 flex items-center gap-1 px-3 py-1.5 rounded-full">
                <img src="/coin.svg" alt="coin" className="w-[24px] mt-1 h-[24px]" />
                <span className="text-[#A7FFD5] text-[16px] font-medium">{topThree[2]?.totalPoints}</span>
              </div>
              
              <img
                src={topThree[2]?.avatar}
                alt={topThree[2]?.username}
                className="w-[130px] h-[130px] rounded-full object-cover border-2 border-[#703C2B]"
              />
              <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-orange-600 text-white text-xs px-3 py-0 podium-third rounded-full font-bold">
                3
              </div>
            </div>
            <div className="text-white font-semibold text-[24px] mb-1">{topThree[2]?.username}</div>
            <div className="text-white bg-[#FFFFFF1A] border border-[#FFFFFF2E] p-1 rounded-[8px] font-medium text-[16px] mb-3">{topThree[2]?.walletAddress}</div>
          </div>
        </div>

        {/* Leaderboard Table */}
<div className="mb-8">
  {/* Table Header */}
  <div className=" mb-3 px-6 py-4">
    <div className="grid grid-cols-[80px_2fr_1fr_1fr_1fr_1fr] gap-4 text-gray-400 text-sm font-medium">
      <div>#</div>
      <div className='text-[#FFFFFF66] font-[500] text-[14px] tracking-[-2%] '>User</div>
      <div className="text-center text-[#FFFFFF66] font-[500] text-[14px] tracking-[-2%] ">Primary Points</div>
      <div className="text-center text-[#FFFFFF66] font-[500] text-[14px] tracking-[-2%] ">Total Points</div>
      <div className="text-center text-[#FFFFFF66] font-[500] text-[14px] tracking-[-2%] ">Bonus Points</div>
      <div className="text-center text-[#FFFFFF66] font-[500] text-[14px] tracking-[-2%] ">Referrals</div>
    </div>
  </div>

  {/* Table Body */}
  <div className="space-y-3">
    {currentData.map((player) => (
      <div
        key={player.rank}
        className=" border border-[#FFFFFF17] rounded-[16px] px-6 py-4 transition-colors"
      >
        <div className="grid grid-cols-[80px_2fr_1fr_1fr_1fr_1fr] gap-4 items-center">
          <div className="text-[#FFFFFF99] font-[500] text-[16px] tracking-[-2%] ">{player.rank}</div>
          
          <div className="flex items-center gap-3">
            <img
              src={player.avatar}
              alt={player.username}
              className="w-10 h-10 rounded-full"
            />
            <div className="flex flex-col">
              <span className="text-[#FFFFFF] font-bold text-[20px] tracking-[-2%] ">{player.username}</span>
              <span className="text-[#FFFFFF99] font-[500] text-[16px] tracking-[-2%] ">{player.walletAddress}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
            <span className="text-[#FFFFFF99] font-[500] text-[16px] tracking-[-2%]">{player.primaryPoints}</span>
          </div>

          <div className="text-[#FFFFFF99] font-[500] text-[16px] tracking-[-2%] text-center">{player.totalPoints}</div>

          <div className="text-[#FFFFFF99] font-[500] text-[16px] tracking-[-2%] text-center">{player.bonusPoints}</div>

          <div className="flex items-center justify-center gap-2">
            <div className="w-5 h-5 rounded bg-emerald-900/40 flex items-center justify-center">
             <img src='/referral.svg' />
            </div>
            <span className="text-[#FFFFFF99] font-[500] text-[16px] tracking-[-2%]">{player.referrals}</span>
          </div>
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