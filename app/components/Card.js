// components/Card.jsx
"use client";
import { FiLock } from "react-icons/fi";
import { useRouter } from "next/navigation";

export default function Card({ card, onBuyClick }) {
  const router = useRouter();

  const getRarityColor = (rarity) => {
    switch (rarity) {
      case "S+":
        return "bg-purple-100 text-purple-700 border-purple-300";
      case "A+":
        return "bg-yellow-100 text-yellow-700 border-yellow-300";
      case "B":
        return "bg-blue-100 text-blue-700 border-blue-300";
      case "C+":
        return "bg-teal-100 text-teal-700 border-teal-300";
      case "Ungraded":
        return "bg-gray-100 text-gray-700 border-gray-300";
      default:
        return "bg-gray-100 text-gray-700 border-gray-300";
    }
  };

  const handleCardClick = () => {
    router.push(`/card/${card.id}`);
  };

  return (
    <div 
      onClick={handleCardClick}
      className="bg-[#1a1a1a] rounded-xl overflow-hidden hover:transform hover:scale-105 transition-all duration-300 border border-gray-800 hover:border-emerald-500/50 cursor-pointer"
    >
      {/* Card Header */}
      <div className="relative">
        <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm px-2 py-1 rounded text-xs text-white z-10">
          {card.year}
        </div>
        <div
          className={`absolute top-3 right-3 px-2 py-1 rounded text-xs font-semibold border z-10 ${getRarityColor(
            card.rarity
          )}`}
        >
          {card.rarity}
        </div>

        {/* Card Image */}
        <div className="aspect-[3/4] bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center p-4">
          {card.image ? (
            <img
              src={card.image}
              alt={card.name}
              className="w-full h-full object-contain rounded-lg"
              onError={(e) => {
                e.target.style.display = "none";
                e.target.nextSibling.style.display = "flex";
              }}
            />
          ) : null}
          <div className="w-full h-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg flex items-center justify-center">
            <div className="text-gray-600 text-sm">Card Image</div>
          </div>
        </div>
      </div>

      {/* Card Details */}
      <div className="p-4">
        <h3 className="text-white font-bold text-lg mb-1 truncate">
          {card.name}
        </h3>
        <p className="text-gray-400 text-xs mb-4 line-clamp-2">
          {card.collection}
        </p>

        {/* Price and Button */}
        <div className="space-y-3">
          <div>
            <p className="text-gray-500 text-xs mb-1">Insured Value</p>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-emerald-500"></div>
              <p className="text-white font-bold text-lg">{card.price}</p>
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation(); // Prevent card click when clicking button
              onBuyClick && onBuyClick(card);
            }}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm transition-colors duration-300 flex items-center justify-center gap-2"
          >
            Buy Now
            <FiLock size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}