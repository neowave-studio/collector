"use client";

import Image from 'next/image';
import learnone from "../../public/learnone.png";
import learntwo from "../../public/learntwo.png"; 
import learnthree from "../../public/learnthre.png"; 

export default function LearnTwoSection() {
  const cardData = [
    {
      image: learnone,
      title: "Filter Streams: Cut Through the Noise",
      description: "Filter Streams let you unify messages from multiple channels and servers into a single feed, so you never miss important updates and stay productive."
    },
    {
      image: learntwo, 
      title: "Organize. Automate. Achieve.",
      description: "Pigeon helps you stay productive by automatically creating tasks using AI, while also letting you manually add and manage your own tasks."
    },
    {
      image: learnthree,
      title: "Unified Inbox", 
      description: "All your DMs into a single Unified Inbox, so you never miss a message again."
    }
  ];

  return (
    <section className="relative w-full pb-[40px] md:pt-[80px] px-4 bg-[#f6f2ee]" id="learn">
      <div className="max-w-[1300px] mx-auto">
        <div className="flex lg:gap-12 md:gap-8 gap-6 lg:flex-row flex-col items-start justify-start">
          {/* Left Side - Text Content */}
          <div className="space-y-6 lg:mt-14 md:mt-8 mt-6 flex-shrink-0 lg:max-w-1/2 max-w-full">
            <h2 className="text-[#333333] lg:leading-[76px] md:leading-[48px] leading-[36px] lg:tracking-[-4px] md:tracking-[-2px] tracking-[-1px] lg:text-[73px] md:text-[48px] text-[32px] font-light md:text-start text-center">
            Designed to unify everything you do.
            </h2>
                        
            <p className="text-[#333333]/60 lg:w-1/2 md:w-3/4 w-full tracking-wide lg:text-[14px] md:text-[13px] text-[12px] font-regular md:text-start text-center">
            By unifying chats, managing your tasks, and integrating multiple apps into a single platform, Pigeon eliminates the need to juggle multiple applications and tools, creating a streamlined and efficient workflow.
            </p>
          </div>
                    
          {/* Right Side - Image */}
          <div className="w-full relative z-0">
            <img 
              src="/cillu.png"
              alt="Dashboard Interface"
              className="w-full h-auto z-10 object-contain"
            />
          </div>
        </div>
                
        <div className="w-full grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 lg:gap-6 md:gap-4 gap-4 lg:mt-16 mt-4">
          {cardData.map((card, index) => (
            <div 
              key={index}
              className="flex flex-col items-center lg:p-6 md:p-4 p-4 rounded-2xl"
              style={{
                backgroundImage: `url('/dotbg.png')`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat'
              }}
            >
              {/* Card Image */}
              <div className="w-full lg:mb-10 md:mb-6 mb-4 flex justify-center">
                <Image 
                  src={card.image}
                  alt={card.title}
                  className={`w-max lg:h-[300px] md:h-[200px] h-[180px] object-contain z-10 rounded-lg mb-12 ${index!==2?"shadow-2xl shadow-[#3474ff50] lg:min-h-[300px]":"lg:w-full lg:h-full"}`}
                  width={1000}
                  height={1000}
                />
              </div>
              <div className="w-full">
                {/* Card Title */}
                <h3 className={`${index===2?"mt-6":""} text-[#333333] lg:text-[16px] md:text-[15px] text-[14px] justify-center lg:justify-start lg:tracking-[-0.18px] md:tracking-[-0.14px] tracking-[-0.1px] lg:leading-[21.6px] md:leading-[20px] leading-[18px] font-semibold lg:mb-3 md:mb-2 mb-2 text-center lg:text-left`}>
                  {card.title}
                </h3>
                                
                {/* Card Description */}
                <p className="text-[#333333]/60  w-full lg:text-[14px] md:text-[13px] text-xs lg:tracking-[-0.18px] md:tracking-[-0.14px] tracking-[-0.1px] lg:leading-[21.6px] md:leading-[20px] leading-[18px] font-regular lg:mb-3 md:mb-2 mb-2 lg:text-left text-center">
                  {card.description}
                </p>
                                
                {/* Learn More Button */}
                {/* <button className="text-[#333333] lg:text-[14px] md:text-[13px] text-[12px] lg:tracking-[-0.4px] md:tracking-[-0.3px] tracking-[-0.2px] lg:leading-[16px] md:leading-[15px] leading-[14px] font-regular lg:mb-3 md:mb-2 mb-2 text-center justify-center flex  lg:mx-0 mx-auto lg:text-left">
                  Learn More
                </button> */}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}