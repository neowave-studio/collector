"use client";

export default function FocusSection() {
  return (
    <section className="relative w-full bg-[#F3EDE7] h-full pb-[50px] pt-[80px]" id="focus"         style={{
        backgroundImage: "url('/focusbg.png')",
        backgroundSize: 'contain',
        backgroundPosition: '0% 0%', 
        backgroundRepeat: 'no-repeat'
        }}>
      <div className="firstSection lg:py-[30px] p-2 md:py-[80px] py-[60px]"
>
        <div className="max-w-[1300px] relative mx-auto py-8 lg:py-14 px-4">
          <img src="meditatingCollector.svg" className="absolute z-0 right-0 bottom-0 lg:top-[-30px] w-[250px] lg:w-[500px] " />
          <div className="flex items-start justify-between">
            {/* Left Side - Text Content */}
            <div className="space-y-6 z-20 lg:max-w-[500px] md:max-w-[400px] max-w-full">
              <h2 className="text-[#333333] lg:text-[73px]  md:text-[48px] text-[36px] font-light lg:tracking-[-4px] md:tracking-[-2px] tracking-[-1px] lg:leading-[76px] md:leading-[48px] leading-[36px]">
                Focus like
                <br />
                 never before!
              </h2>
                        
              <p className="text-[#111111]/80 lg:text-[15px] lg:w-full w-1/2 max-w-[90%] md:text-[14px] text-[13px] font-regular tracking-[0px] lg:leading-[21px] md:leading-[20px] leading-[19px]">
              Staying focused is tough when constant notifications pull you in every direction. Collector’s Focus Mode reduces the noise by silencing non-essential alerts and prioritizing only the updates that matter. Whether you’re working, studying, or catching alpha, Focus Mode helps you stay distraction-free and fully productive.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Box */}
      <div className="flex z-20  lg:flex-row flex-col lg:justify-between lg:items-center items-start max-w-[1300px] border border-[#111111]/20 mx-auto lg:mx-auto md:mx-4  lg:p-14 md:p-8 p-6 bg-[#F3EDE7]  rounded-[6px]">
        <div className="lg:mb-6 md:mb-4 mb-4 flex flex-col lg:gap-10 md:gap-6 gap-4">
          <div>
            <p className="text-[#333333]/80 lg:text-[15px] md:text-[14px] text-[13px] font-regular tracking-[0px] lg:leading-[21px] md:leading-[20px] leading-[19px]">
              Occasio no born intenda si 0.5% oget.
              <br />
              Dquid illo Adipiscing baspoli est id.
            </p>
          </div>
                     
          {/* Learn More Button */}
          <div>
            {/* <button className="inline-flex items-center lg:px-7 lg:py-3 md:px-6 md:py-2.5 px-5 py-2 bg-transparent border-2 border-[#3474FF] text-[#3474FF] rounded-[6px] hover:bg-[#3474FF] hover:text-white transition-colors lg:text-[15px] md:text-[14px] text-[13px] duration-300 font-medium">
              Learn More
            </button> */}
          </div>
        </div>
                                     
        {/* Stats */}
        <div className="flex lg:flex-row md:flex-row flex-col lg:py-10 md:py-6 py-4 h-full lg:gap-[100px] md:gap-12 gap-8">
          {/* Messages Stat */}
          <div className="flex lg:flex-col md:flex-col flex-row justify-center lg:gap-24 md:gap-4 gap-4 h-full items-center lg:items-center md:items-start">
            <div className="text-[#333333] lg:text-[60px] md:text-[48px] text-[36px] font-semibold lg:tracking-[-2.5px] md:tracking-[-2px] tracking-[-1.5px] leading-none lg:mb-2 md:mb-1 mb-0">
              1.3M
            </div>
            <div className="text-[#333333]/60 lg:leading-[20px] md:leading-[18px] leading-[16px] lg:tracking-[0.16px] md:tracking-[0.14px] tracking-[0.12px] lg:text-[15px] md:text-[14px] text-[13px] font-semibold">
              Messages
            </div>
          </div>
                                            
          {/* Uptime Stat */}
          <div className="flex lg:flex-col md:flex-col flex-row justify-center lg:gap-24 md:gap-4 gap-4 h-full items-center lg:items-center md:items-start">
            <div className="text-[#333333] lg:text-[60px] md:text-[48px] text-[36px] font-semibold lg:tracking-[-2.5px] md:tracking-[-2px] tracking-[-1.5px] leading-none lg:mb-2 md:mb-1 mb-0">
              24h
            </div>
            <div className="text-[#333333]/60 lg:leading-[20px] md:leading-[18px] leading-[16px] lg:tracking-[0.16px] md:tracking-[0.14px] tracking-[0.12px] lg:text-[15px] md:text-[14px] text-[13px] font-semibold">
              Uptime
            </div>
          </div>
                            
          {/* AI Memory Stat */}
          <div className="flex lg:flex-col md:flex-col flex-row justify-center lg:gap-24 md:gap-4 gap-4 h-full items-center lg:items-center md:items-start">
            <div className="text-[#333333] lg:text-[60px] md:text-[48px] text-[36px] font-semibold lg:tracking-[-2.5px] md:tracking-[-2px] tracking-[-1.5px] leading-none lg:mb-2 md:mb-1 mb-0">
              365d
            </div>
            <div className="text-[#333333]/60 lg:leading-[20px] md:leading-[18px] leading-[16px] lg:tracking-[0.16px] md:tracking-[0.14px] tracking-[0.12px] lg:text-[15px] md:text-[14px] text-[13px] font-semibold">
              AI Memory
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}