"use client";

import { useState } from "react";
import { FiCopy } from "react-icons/fi";
import Pagination from "@/app/components/Pagination";
import Reveal from '@/app/components/Reveal';

export default function UserProfilePage({ userId }) {
  const [activeTab, setActiveTab] = useState("assets");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // User profile data
  const userData = {
    username: "Coud",
    year: "2019",
    avatar: "/avatar.png",
    walletAddress: "0x7aA23F23D32f9A8C422DFdb2e52AfB20b889Dd2C",
    joinedDate: "August 2025",
    totalCards: 127,
    estimatedValue: "$234,556.02",
  };

  // Tab configurations - easily customizable
  const tabConfigs = {
    assets: {
      name: "Assets",
      headers: ["Item", "Price", "Insured Value", "Grade", "Timestamp"],
      data: [
        {
          id: 1,
          item: { image: "/card1.png", name: "2006 Celebi Gold Star - EX Crystal Guardians" },
          price: "0.34 SOL",
          insuredValue: "$200.23",
          grade: "Ungraded",
          timestamp: "9/9/25, 11:02:20 pm",
        },
        {
          id: 2,
          item: { image: "/card2.png", name: "1999 Charizard - Base Set" },
          price: "1.20 SOL",
          insuredValue: "$300.59",
          grade: "A+",
          timestamp: "9/8/25, 10:45:00 am",
        },
        {
          id: 3,
          item: { image: "/card3.png", name: "2000 Lugia - Neo Genesis" },
          price: "0.85 SOL",
          insuredValue: "$200.23",
          grade: "A+",
          timestamp: "9/7/25, 2:15:30 pm",
        },
        {
          id: 4,
          item: { image: "/card4.png", name: "2003 Rayquaza - EX Deoxys" },
          price: "1.50 SOL",
          insuredValue: "$450.00",
          grade: "Ungraded",
          timestamp: "9/10/25, 3:30:00 pm",
        },
        {
          id: 5,
          item: { image: "/card5.png", name: "1996 Mewtwo - Base Set" },
          price: "0.45 SOL",
          insuredValue: "$150.75",
          grade: "Ungraded",
          timestamp: "9/9/25, 4:22:10 pm",
        },
        {
          id: 6,
          item: { image: "/card6.png", name: "2005 Gardevoir - EX Emerald" },
          price: "0.60 SOL",
          insuredValue: "$180.50",
          grade: "Ungraded",
          timestamp: "9/8/25, 1:12:45 pm",
        },
        {
          id: 7,
          item: { image: "/card7.png", name: "2016 Tapu Koko GX - Sun & Moon" },
          price: "2.00 SOL",
          insuredValue: "$600.00",
          grade: "Ungraded",
          timestamp: "9/12/25, 9:05:15 am",
        },
        {
          id: 8,
          item: { image: "/card8.png", name: "2001 Tyranitar - Neo Discovery" },
          price: "0.75 SOL",
          insuredValue: "$250.00",
          grade: "Ungraded",
          timestamp: "9/11/25, 6:40:00 pm",
        },
        {
          id: 9,
          item: { image: "/card1.png", name: "2003 Rayquaza - EX Deoxys" },
          price: "1.20 SOL",
          insuredValue: "$400.00",
          grade: "Graded",
          timestamp: "9/12/25, 5:30:00 pm",
        },
        {
          id: 10,
          item: { image: "/card2.png", name: "1999 Charizard - Base Set" },
          price: "2.50 SOL",
          insuredValue: "$850.00",
          grade: "Graded",
          timestamp: "9/13/25, 4:00:00 pm",
        },
      ],
    },
    activity: {
      name: "Activity",
      headers: ["Action", "Item", "Amount", "From/To", "Timestamp"],
      data: [
        {
          id: 1,
          action: "Purchase",
          item: { image: "/card1.png", name: "2006 Celebi Gold Star" },
          amount: "0.34 SOL",
          fromTo: "0x123...456",
          timestamp: "9/9/25, 11:02:20 pm",
        },
        {
          id: 2,
          action: "Sale",
          item: { image: "/card2.png", name: "1999 Charizard" },
          amount: "1.20 SOL",
          fromTo: "0x789...012",
          timestamp: "9/8/25, 10:45:00 am",
        },
        {
          id: 3,
          action: "Transfer",
          item: { image: "/card3.png", name: "2000 Lugia" },
          amount: "0.85 SOL",
          fromTo: "0xabc...def",
          timestamp: "9/7/25, 2:15:30 pm",
        },
      ],
    },
    activityListings: {
      name: "Activity Listings",
      headers: ["Item", "Listed Price", "Status", "Views", "Timestamp"],
      data: [
        {
          id: 1,
          item: { image: "/card1.png", name: "2006 Celebi Gold Star" },
          listedPrice: "0.50 SOL",
          status: "Active",
          views: 245,
          timestamp: "9/9/25, 11:02:20 pm",
        },
        {
          id: 2,
          item: { image: "/card2.png", name: "1999 Charizard" },
          listedPrice: "1.50 SOL",
          status: "Sold",
          views: 512,
          timestamp: "9/8/25, 10:45:00 am",
        },
      ],
    },
    offersMade: {
      name: "Offers Made",
      headers: ["Item", "Offer Amount", "Status", "Seller", "Timestamp"],
      data: [
        {
          id: 1,
          item: { image: "/card1.png", name: "2006 Celebi Gold Star" },
          offerAmount: "0.30 SOL",
          status: "Pending",
          seller: "0x123...456",
          timestamp: "9/9/25, 11:02:20 pm",
        },
        {
          id: 2,
          item: { image: "/card2.png", name: "1999 Charizard" },
          offerAmount: "1.00 SOL",
          status: "Rejected",
          seller: "0x789...012",
          timestamp: "9/8/25, 10:45:00 am",
        },
        {
          id: 3,
          item: { image: "/card3.png", name: "2000 Lugia" },
          offerAmount: "0.75 SOL",
          status: "Accepted",
          seller: "0xabc...def",
          timestamp: "9/7/25, 2:15:30 pm",
        },
      ],
    },
    offersReceived: {
      name: "Offers Received",
      headers: ["Item", "Offer Amount", "Status", "Buyer", "Timestamp"],
      data: [
        {
          id: 1,
          item: { image: "/card4.png", name: "2003 Rayquaza" },
          offerAmount: "1.40 SOL",
          status: "Pending",
          buyer: "0x321...654",
          timestamp: "9/10/25, 3:30:00 pm",
        },
        {
          id: 2,
          item: { image: "/card5.png", name: "1996 Mewtwo" },
          offerAmount: "0.40 SOL",
          status: "Rejected",
          buyer: "0x987...210",
          timestamp: "9/9/25, 4:22:10 pm",
        },
      ],
    },
  };

  const currentTabConfig = tabConfigs[activeTab];
  const totalPages = Math.ceil(currentTabConfig.data.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentData = currentTabConfig.data.slice(startIndex, endIndex);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const getGradeColor = (grade) => {
    if (grade === "Graded") return "bg-yellow-600 text-white";
    if (grade === "A+" || grade === "A") return "bg-yellow-500 text-black";
    return "bg-gray-600 text-white";
  };

  const getStatusColor = (status) => {
    if (status === "Active" || status === "Accepted") return "text-emerald-400";
    if (status === "Pending") return "text-yellow-400";
    if (status === "Sold" || status === "Rejected") return "text-gray-400";
    return "text-white";
  };

  return (
    <div className="min-h-screen bg-black pt-20">
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Profile Header */}
        <Reveal className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 mb-8" y={26} delay={80}>
          <div className="flex items-start gap-6">
            {/* Avatar */}
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-400 via-purple-400 to-pink-400 flex items-center justify-center flex-shrink-0 hover-scale">
              <span className="text-white text-3xl">👤</span>
            </div>

            {/* User Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-white text-3xl font-bold">{userData.username}</h1>
                <span className="px-3 py-1 bg-gray-800 text-gray-400 rounded-lg text-sm">
                  {userData.year}
                </span>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <span className="text-gray-400 text-sm font-mono">
                  {userData.walletAddress}
                </span>
                <button
                  onClick={() => copyToClipboard(userData.walletAddress)}
                  className="text-gray-400 hover:text-white transition-colors icon-hover"
                >
                  <FiCopy size={16} />
                </button>
              </div>

              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-gray-400">Joined </span>
                  <span className="text-white">{userData.joinedDate}</span>
                </div>
                <div className="w-px h-4 bg-gray-700"></div>
                <div>
                  <span className="text-gray-400">Total Cards: </span>
                  <span className="text-white">{userData.totalCards}</span>
                </div>
                <div className="w-px h-4 bg-gray-700"></div>
                <div>
                  <span className="text-gray-400">Est. Value: </span>
                  <span className="text-white">{userData.estimatedValue}</span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Tabs */}
        <Reveal className="flex gap-2 mb-6 overflow-x-auto" y={22} delay={160}>
          {Object.entries(tabConfigs).map(([key, config]) => (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key);
                setCurrentPage(1);
              }}
              className={`btn-anim px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === key
                  ? "bg-gray-800 text-white"
                  : "bg-gray-900/50 text-gray-400 hover:text-white hover:bg-gray-800/50"
              }`}
            >
              {config.name}
            </button>
          ))}
        </Reveal>

        {/* Table */}
        <Reveal className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden mb-8" y={24} delay={240}>
          {/* Table Header */}
          <div
            className="grid gap-4 px-6 py-4 bg-gray-900/50 border-b border-gray-800 text-gray-400 text-sm font-medium"
            style={{
              gridTemplateColumns: `repeat(${currentTabConfig.headers.length}, minmax(0, 1fr))`,
            }}
          >
            {currentTabConfig.headers.map((header, index) => (
              <div key={index} className={index === 0 ? "" : "text-center"}>
                {header}
              </div>
            ))}
          </div>

          {/* Table Body */}
          <div className="divide-y divide-gray-800">
            {currentData.map((row) => (
              <div
                key={row.id}
                className="grid gap-4 px-6 py-4 hover:bg-gray-800/30 transition-colors items-center"
                style={{
                  gridTemplateColumns: `repeat(${currentTabConfig.headers.length}, minmax(0, 1fr))`,
                }}
              >
                {Object.entries(row).map(([key, value], index) => {
                  if (key === "id") return null;

                  // Item column with image and name
                  if (key === "item" && typeof value === "object") {
                    return (
                      <div key={index} className="flex items-center gap-3">
                        <div className="w-12 h-16 bg-gray-800 rounded flex-shrink-0">
                          <div className="w-full h-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded"></div>
                        </div>
                        <span className="text-white text-sm">{value.name}</span>
                      </div>
                    );
                  }

                  // Grade column with badge
                  if (key === "grade") {
                    return (
                      <div key={index} className="flex justify-center">
                        <span
                          className={`px-3 py-1 rounded text-xs font-semibold ${getGradeColor(
                            value
                          )}`}
                        >
                          {value}
                        </span>
                      </div>
                    );
                  }

                  // Status column with color
                  if (key === "status") {
                    return (
                      <div key={index} className="text-center">
                        <span className={`text-sm font-semibold ${getStatusColor(value)}`}>
                          {value}
                        </span>
                      </div>
                    );
                  }

                  // From/To, Seller, Buyer columns (wallet addresses)
                  if (key === "fromTo" || key === "seller" || key === "buyer") {
                    return (
                      <div key={index} className="text-center">
                        <span className="text-gray-400 text-sm font-mono">{value}</span>
                      </div>
                    );
                  }

                  // Default column
                  return (
                    <div key={index} className="text-center">
                      <span className="text-white text-sm">{value}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Reveal>

        {/* Pagination */}
        <Reveal y={20} delay={120}>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            totalItems={currentTabConfig.data.length}
            itemsPerPage={itemsPerPage}
          />
        </Reveal>
      </div>
    </div>
  );
}