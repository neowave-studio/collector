// components/Card.jsx
"use client";
import { FiLock } from "react-icons/fi";
import { useRouter } from "next/navigation";
import Image from "next/image";
export default function Card({ card, onBuyClick }) {
  const router = useRouter();
const getRarityColor = (rarity) => {
  const rarityUpper = rarity.toUpperCase();
  
  // Check if it starts with S (S, S+, S++, etc.)
  if (rarityUpper.startsWith('S')) {
    return "rarity-s";
  }
  // Check if it starts with A (A, A+, A++, etc.)
  else if (rarityUpper.startsWith('A')) {
    return "rarity-a";
  }
  // Check if it starts with B (B, B+, B++, etc.)
  else if (rarityUpper.startsWith('B')) {
    return "rarity-b";
  }
  // Ungraded or default
  else {
    return "rarity-ungraded";
  }
};

  const handleCardClick = () => {
    router.push(`/card/${card.id}`);
  };

  return (
    <div 
      onClick={handleCardClick}
      className="bg-[#101010] rounded-[12px] overflow-hidden hover:transform hover:scale-105 transition-all duration-300 border border-[#FFFFFF1A] cursor-pointer"
    >
      {/* Card Header */}
      <div className="relative">
        <div className="absolute top-3 left-3 text-[#FFFFFF99] font-[500] text-[14px] leading-[140%] tracking-[-3%] backdrop-blur-sm px-2 py-1 rounded z-10">
          {card.year}
        </div>
        <div
          className={`absolute top-3 right-3 rounded-lg px-3 py-0 min-w-fit mx-auto flex justify-center  text-[#FFFFFF99] font-[700] text-[14px] leading-[150%] tracking-[-3%]  border z-10 ${getRarityColor(
            card.rarity
          )}`}
        >
          {card.rarity}
        </div>

        {/* Card Image */}
{/* Card Image */}
<div className="flex items-center w-full justify-center px-14 pt-14">
  {card.image ? (
    <div className="w-full aspect-[5/7]">
      <img
        src={card.image}
        alt={card.name}
        className="w-full  h-full object-contain  rounded-lg"
      />
    </div>
  ) : null}
</div>
      </div>

      {/* Card Details */}
      <div className="px-4 py-2 pb-4">
        <h3 className="text-white font-bold text-[24px] leading-[150%] tracking-[-3%]  truncate">
          {card.name}
        </h3>
        <p className="text-[#FFFFFF99] font-[500] text-[14px] leading-[140%] tracking-[-3%] mb-4 line-clamp-2">
          {card.collection}
        </p>

        {/* Price and Button */}
        <div className="space-y-3 ">
          <div className="mb-5">
                   <p className="text-[#FFFFFF99] font-[500] text-[14px] leading-[140%] tracking-[-3%] mb-2 ">Insured Value</p>
<div className="flex items-center justify-start gap-2 ">
  <div className="flex items-center justify-center w-[24px] h-[24px] ">
    <Image src="/coin.svg" alt="coin" width={24} height={24} className="mt-1" />
  </div>
  <p className="text-[#FFFFFF] font-[700] text-[18px] leading-[150%] tracking-[-3%]">
    {card.price}
  </p>
</div>
          </div>

<button
  onClick={(e) => {
    e.stopPropagation(); // Prevent card click when clicking button
    onBuyClick && onBuyClick(card);
  }}
  className="buy-now-button w-full rounded-[16px] border px-3 py-4 border-[#FFFFFF1A] font-[600] text-[16px] leading-[100%] tracking-[-3%] duration-300 flex items-center justify-center gap-2"
>
  <span className="buy-now-button-text">Buy Now</span>
  <Image src="/lock.svg" alt="lock" width={18} height={18} />
</button>
        </div>
      </div>
    </div>
  );
}