"use client";
import featureone from "../../public/featureone.png"
import featuretwo from "../../public/featuretwo.png"
import featurethree from "../../public/featurethree.png"
import featurefour from "../../public/featurefour.png"
import Image from "next/image";
export default function FeatureSections() {
  return (
    <div className="w-full bg-[#111819]">
      <FeatureSectionOne />
      <FeatureSectionTwo />
      <FeatureSectionThree />
    </div>
  );
}

// Section 1 - Content on left, images on right, content at top
function FeatureSectionOne() {
  return (
<section className="relative w-full py-12 px-4">
  <div className="max-w-[1300px] relative mx-auto border border-[#333333] p-10 rounded-[24px]">
    <div className="flex lg:flex-row flex-col-reverse lg:items-stretch items-center justify-between gap-12 lg:min-h-[500px] md:text-start text-center">
      
      {/* Content Side - Shorter and positioned */}
      <div className="flex-1 lg:max-w-[400px] max-w-full space-y-4 flex flex-col justify-end md:mb-6 mb-0">
        {/* Label */}
        {/* <div className="text-[#F3EDE7]/60 leading-[16px] uppercase tracking-[2px] text-[12px] font-regular mb-3">
          CONVERSATIONS
        </div> */}
        
        {/* Title */}
        <h2 className="text-[#F3EDE7] leading-[21px] text-[16px] font-semibold">
        Unified Inbox
        </h2>
        
        {/* Description */}
        <p className="text-[#F3EDE7]/60 leading-[21px] text-[14px] mb-8 font-regular">
        Managing messages across multiple servers and apps can be overwhelming. Pigeon’s Unified Inbox brings all your direct messages into a single, organized feed, so you never miss important conversations. With smart labels, every message is automatically tagged to show which server or app it came from, making it easy to prioritize, track, and respond. Whether it’s a quick question from a friend, an update from a community, or an important alert, everything lands in one place, saving you time and boosting your productivity.
        </p>
        
        {/* Button */}
        {/* <button className="hover:bg-white hover:text-black items-center w-fit px-6 py-4 bg-transparent border-2 border-white text-white rounded-[6px]  transition-all duration-300 text-[15px] font-medium">
          Learn More »
        </button> */}
      </div>

      {/* Images Side - Full Height */}
      <div className="flex-1 relative h-full">
        <div className="flex justify-end h-full">
          <img
            src="featureone.png"
            alt="Feature Image"
            className="w-auto h-full max-h-[400px] lg:max-h-[500px] object-cover rounded-lg shadow-lg"
            onError={(e) => {
              e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='500' fill='%23444'%3E%3Crect width='100%25' height='100%25'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23999'%3EImage%3C/text%3E%3C/svg%3E";
            }}
          />
        </div>
      </div>
    </div>
  <Image alt="Feature Image" src="/think.svg" width={200} height={200} className="absolute bottom-0 left-60 w-16"/>
  </div>
</section>
  );
}

// Section 2 - Images on left, content on right, content centered
function FeatureSectionTwo() {
  return (
<section className="relative w-full  px-4">
  <div className="max-w-[1300px] mx-auto border border-[#333333] p-10 rounded-[24px]">
    <div className="flex lg:flex-row-reverse flex-col-reverse lg:items-stretch items-center justify-between gap-12 lg:min-h-[500px]">
      
      {/* Content Side - Shorter and positioned */}
      <div className="flex-1 lg:max-w-[400px] max-w-full space-y-4 flex flex-col justify-end md:text-start text-center">
        {/* Label */}
        {/* <div className="text-[#F3EDE7]/60 leading-[16px] uppercase tracking-[2px] text-[12px] font-regular mb-3">
          CONVERSATIONS
        </div> */}
        
        {/* Title */}
        <h2 className="text-[#F3EDE7] leading-[21px] text-[16px] font-semibold">
        AI-Powered Task Management
        </h2>
        
        {/* Description */}
        <p className="text-[#F3EDE7]/60 leading-[21px] text-[14px] mb-8 font-regular">
        Staying productive is easy with Pigeon. Our AI automatically creates to-do tasks for you while giving you full control to add, organize, and track tasks on your own. By combining automation with personal management, Pigeon helps you focus on what matters most and get more done in less time.
        </p>
        
        {/* Button */}
        {/* <button className="hover:bg-white hover:text-black items-center w-fit px-6 py-4 bg-transparent border-2 border-white text-white rounded-[6px]  transition-all duration-300 text-[15px] font-medium">
          Learn More »
        </button> */}
      </div>

      {/* Images Side - Full Height */}
      <div className="flex-1 relative h-full">
        <div className="flex justify-start h-full">
          <img
            src="featuretwo.png"
            alt="Feature Image"
            className="w-auto h-full max-h-[400px] lg:max-h-[500px] object-cover rounded-lg shadow-lg"
            onError={(e) => {
              e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='500' fill='%23444'%3E%3Crect width='100%25' height='100%25'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23999'%3EImage%3C/text%3E%3C/svg%3E";
            }}
          />
        </div>
      </div>
    </div>
  </div>
</section>
  );
}

// Section 3 - Content on left, images on right, content at bottom
function FeatureSectionThree() {
  return (
   <section className="relative w-full py-12 px-4">
  <div className="max-w-[1300px] mx-auto border border-[#333333] p-10 rounded-[24px]">
    <div className="flex xl:flex-row flex-col-reverse lg:items-stretch items-center justify-between gap-12 lg:min-h-[500px] md:text-start text-center">
      
      {/* Content Side - Shorter and positioned */}
      <div className="flex-1 lg:max-w-[400px] max-w-full space-y-4 flex flex-col justify-end md:text-start text-center">
        {/* Label */}
        {/* <div className="text-[#F3EDE7]/60 leading-[16px] uppercase tracking-[2px] text-[12px] font-regular mb-3">
          CONVERSATIONS
        </div> */}
        
        {/* Title */}
        <h2 className="text-[#F3EDE7] leading-[21px] text-[16px] font-semibold">
        Smart Summary
        </h2>
        
        {/* Description */}
        <p className="text-[#F3EDE7]/60 leading-[21px] text-[14px] mb-8 font-regular">
        Stay effortlessly up-to-date with our Smart Summary feature. It scans conversations across platforms or within servers and creates clear, concise summaries, so you can catch all the important updates without scrolling through endless chats.
        </p>
        
        {/* Button */}
        {/* <button className="hover:bg-white hover:text-black items-center w-fit px-6 py-4 bg-transparent border-2 border-white text-white rounded-[6px]  transition-all duration-300 text-[15px] font-medium">
          Learn More »
        </button> */}
      </div>

{/* Images Side - Full Height */}
<div className="flex-1 relative h-full">
  <div className="flex lg:flex-row flex-col justify-center items-center h-full gap-4">
    <img
      src="featurethree.png"
      alt="Feature Image"
      className="w-auto h-full max-h-[400px] lg:max-h-[500px] object-cover rounded-lg shadow-lg"
      onError={(e) => {
        e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='500' fill='%23444'%3E%3Crect width='100%25' height='100%25'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23999'%3EImage 1%3C/text%3E%3C/svg%3E";
      }}
    />
    
    {/* <img
      src="featurefour.png"
      alt="Feature Image"
      className="w-auto h-full max-h-[400px] lg:max-h-[500px] object-cover rounded-lg shadow-lg"
      onError={(e) => {
        e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='500' fill='%23444'%3E%3Crect width='100%25' height='100%25'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23999'%3EImage 2%3C/text%3E%3C/svg%3E";
      }}
    /> */}
  </div>
</div>

    </div>
  </div>
</section>
  );
}