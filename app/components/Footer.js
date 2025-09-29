"use client";

import { useState } from 'react';

export default function FooterSection() {
  const [email, setEmail] = useState('');
  const [isDisabled, setIsDisabled] = useState(false);
  const handleNewsletterSubmit = (e) => {
    e.preventDefault();
    console.log('Newsletter subscription:', email);
    // Handle newsletter subscription
    setEmail('');
  };

  const currentYear = new Date().getFullYear();

  // Organized into 4 columns like Discord
  const productLinks = [
    { name: 'Download', href: '/download' },
    // { name: 'Nitro', href: '/nitro' },
    { name: 'Status', href: '/status' },
    { name: 'App Directory', href: '/app-directory' }
  ];

  const companyLinks = [
    { name: 'Docs', href: '/docs' },
    { name: 'About', href: '/about' },
    // { name: 'Jobs', href: '/jobs' },
    { name: 'Brand Kit', href: '/brand' },
    { name: 'Newsroom', href: '/newsroom' }
  ];

  const resourceLinks = [
    { name: 'College', href: '/college' },
    { name: 'Support', href: '/support' },
    { name: 'Safety', href: '/safety' },
    { name: 'Blog', href: '/blog' },
    { name: 'Feedback', href: '/feedback' },
    { name: 'StreamKit', href: '/streamkit' },
    { name: 'Creators', href: '/creators' },
    { name: 'Community', href: '/community' },
    { name: 'Developers', href: '/developers' },
    { name: 'Gaming', href: '/gaming' },
    { name: 'Official 3rd Party Merch', href: '/merch' }
  ];

  const policiesLinks = [
    { name: 'Terms', href: '/terms' },
    { name: 'Privacy', href: '/privacy' },
    // { name: 'Cookie Settings', href: '/cookies' },
    { name: 'Guidelines', href: '/guidelines' },
    // { name: 'Acknowledgements', href: '/acknowledgements' },
    { name: 'Licenses', href: '/licenses' },
    { name: 'Company Information', href: '/company-info' }
  ];

  return (
    <footer 
      className="lg:py-20 md:py-16 py-12 lg:pt-[100px] md:pt-[80px] pt-[60px] bg-[#F3EDE7] text-white relative overflow-hidden" 
      // style={{
      //   backgroundImage: 'url(/footerbg.png)', 
      //   backgroundSize: 'cover', 
      //   backgroundPosition: 'center', 
      //   backgroundRepeat: 'no-repeat'
      // }}
    >
      {/* Background Decorative Elements */}
      <div className="bg-cover bg-center bg-no-repeat bg-[url('/footerbg.png')] absolute top-0 left-0 w-full h-full">  
</div>
      
      <div className="relative z-10">

        <div className='max-w-[1300px] mx-auto relative flex justify-center lg:mb-[150px] md:mb-[100px] mb-[80px]'>
          <img 
            src='footerpigeonlogo.svg' 
            alt="Footer Logo"
            className="lg:w-auto md:w-[80%] w-[70%] h-auto"
          />
          <img 
            src='pigeonfooter.svg' 
            className='absolute left-1/2 transform -translate-x-1/2 lg:-translate-y-[50px] md:-translate-y-[40px] -translate-y-[30px] lg:w-auto md:w-[60%] w-[50%]' 
            alt="Pigeon Footer"
          />
        </div>

        {/* Main Footer Content */}
        <div className="container mx-auto lg:px-8 md:px-6 px-4 lg:py-16 md:py-12 py-8">
          <div className="flex flex-col lg:flex-row justify-between lg:gap-12 md:gap-8 gap-6">
            
            {/* Left Section - Logo and Social Media */}
            <div className="lg:max-w-sm md:max-w-md max-w-full">
              {/* Logo/Brand Section */}
              <div className="lg:mb-4 md:mb-3 mb-3">
                <img
                  src="/svg.png"
                  alt="Logo"
                  className="h-auto w-16"
                  onError={(e) => {
                    // Fallback if logo.svg doesn't exist
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'block';
                  }}
                />
              </div>

              {/* Social Media */}
              <div>
                <p className="text-[#333333]/50 lg:leading-[20px] md:leading-[18px] leading-[16px] font-regular lg:text-[16px] md:text-[15px] text-[14px] mb-4 block">
                  Social
                </p>
                <div className="flex lg:space-x-4 md:space-x-3 space-x-3">
                  <a 
                    href="https://x.com/pigeondotchat" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="lg:w-10 lg:h-10 md:w-9 md:h-9 w-8 h-8 bg-white/10 hover:bg-white hover:text-[#5865f2] rounded-lg flex items-center justify-center text-black transition-all duration-300 group"
                  >
                    <svg width="24" height="26" viewBox="0 0 24 26" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clipPath="url(#clip0_320_30498)">
<g clipPath="url(#clip1_320_30498)">
<path d="M13.861 12.0521L21.1447 3.5835H19.4187L13.0942 10.9367L8.04291 3.5835H2.2168L9.8554 14.7028L2.2168 23.5835H3.94291L10.6217 15.8182L15.9563 23.5835H21.7824L13.861 12.0521ZM11.4968 14.8008L10.7229 13.6935L4.56485 4.88318H7.21605L12.1857 11.9934L12.9596 13.1006L19.4195 22.3429H16.7683L11.4968 14.8008Z" fill="#333333"/>
</g>
</g>
<defs>
<clipPath id="clip0_320_30498">
<rect width="24" height="25" fill="white" transform="translate(0 0.885742)"/>
</clipPath>
<clipPath id="clip1_320_30498">
<rect width="24" height="25" fill="white" transform="translate(0 0.885742)"/>
</clipPath>
</defs>
</svg>

                  </a>

                  <a 
                    href="https://instagram.com/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="lg:w-10 lg:h-10 md:w-9 md:h-9 w-8 h-8 bg-white/10 hover:bg-white hover:text-[#5865f2] rounded-lg flex items-center justify-center text-black transition-all duration-300 group"
                  >
                    <svg className="lg:w-5 lg:h-5 md:w-4 md:h-4 w-4 h-4 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                  </a>

                  <a 
                    href="https://instagram.com/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="lg:w-10 lg:h-10 md:w-9 md:h-9 w-8 h-8 bg-white/10 hover:bg-white hover:text-[#5865f2] rounded-lg flex items-center justify-center text-black transition-all duration-300 group"
                  >
<svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="100" height="100" viewBox="0 0 50 50"
style={{fill:'#1A1A1A', scale: 0.7}}>
<path d="M 41.625 10.769531 C 37.644531 7.566406 31.347656 7.023438 31.078125 7.003906 C 30.660156 6.96875 30.261719 7.203125 30.089844 7.589844 C 30.074219 7.613281 29.9375 7.929688 29.785156 8.421875 C 32.417969 8.867188 35.652344 9.761719 38.578125 11.578125 C 39.046875 11.867188 39.191406 12.484375 38.902344 12.953125 C 38.710938 13.261719 38.386719 13.429688 38.050781 13.429688 C 37.871094 13.429688 37.6875 13.378906 37.523438 13.277344 C 32.492188 10.15625 26.210938 10 25 10 C 23.789063 10 17.503906 10.15625 12.476563 13.277344 C 12.007813 13.570313 11.390625 13.425781 11.101563 12.957031 C 10.808594 12.484375 10.953125 11.871094 11.421875 11.578125 C 14.347656 9.765625 17.582031 8.867188 20.214844 8.425781 C 20.0625 7.929688 19.925781 7.617188 19.914063 7.589844 C 19.738281 7.203125 19.34375 6.960938 18.921875 7.003906 C 18.652344 7.023438 12.355469 7.566406 8.320313 10.8125 C 6.214844 12.761719 2 24.152344 2 34 C 2 34.175781 2.046875 34.34375 2.132813 34.496094 C 5.039063 39.605469 12.972656 40.941406 14.78125 41 C 14.789063 41 14.800781 41 14.8125 41 C 15.132813 41 15.433594 40.847656 15.621094 40.589844 L 17.449219 38.074219 C 12.515625 36.800781 9.996094 34.636719 9.851563 34.507813 C 9.4375 34.144531 9.398438 33.511719 9.765625 33.097656 C 10.128906 32.683594 10.761719 32.644531 11.175781 33.007813 C 11.234375 33.0625 15.875 37 25 37 C 34.140625 37 38.78125 33.046875 38.828125 33.007813 C 39.242188 32.648438 39.871094 32.683594 40.238281 33.101563 C 40.601563 33.515625 40.5625 34.144531 40.148438 34.507813 C 40.003906 34.636719 37.484375 36.800781 32.550781 38.074219 L 34.378906 40.589844 C 34.566406 40.847656 34.867188 41 35.1875 41 C 35.199219 41 35.210938 41 35.21875 41 C 37.027344 40.941406 44.960938 39.605469 47.867188 34.496094 C 47.953125 34.34375 48 34.175781 48 34 C 48 24.152344 43.785156 12.761719 41.625 10.769531 Z M 18.5 30 C 16.566406 30 15 28.210938 15 26 C 15 23.789063 16.566406 22 18.5 22 C 20.433594 22 22 23.789063 22 26 C 22 28.210938 20.433594 30 18.5 30 Z M 31.5 30 C 29.566406 30 28 28.210938 28 26 C 28 23.789063 29.566406 22 31.5 22 C 33.433594 22 35 23.789063 35 26 C 35 28.210938 33.433594 30 31.5 30 Z"></path>
</svg>
                  </a>

                  <a 
                    href="https://linkedin.com/company/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="lg:w-10 lg:h-10 md:w-9 md:h-9 w-8 h-8 bg-white/10 hover:bg-white hover:text-[#5865f2] rounded-lg flex items-center justify-center text-black transition-all duration-300 group"
                  >
                    <svg className="lg:w-5 lg:h-5 md:w-4 md:h-4 w-4 h-4 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                  </a>

                  {/* <a 
                    href="https://wa.me/919876543210" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="lg:w-10 lg:h-10 md:w-9 md:h-9 w-8 h-8 bg-white/10 hover:bg-white hover:text-[#5865f2] rounded-lg flex items-center justify-center text-black transition-all duration-300 group"
                  >
                    <svg className="lg:w-5 lg:h-5 md:w-4 md:h-4 w-4 h-4 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893A11.821 11.821 0 0020.484 3.488"/>
                    </svg>
                  </a> */}
                </div>
              </div>
            </div>

            {/* Right Section - 4 Columns of Links */}
           {!isDisabled && <div className="flex-1 grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 lg:gap-0 md:gap-8 gap-6 lg:max-w-[45%]">
              
              {/* Product Links */}
              <div className='w-min '>
                <h3 className="text-[#333333]/50 lg:leading-[24px] md:leading-[22px] leading-[20px] font-regular lg:text-[16px] md:text-[15px] text-[14px] lg:mb-3 md:mb-2 mb-2">Product</h3>
                <ul className="lg:space-y-2 md:space-y-1 space-y-1 w-min ">
                  {productLinks.map((link) => (
                    <li key={link.name}>
                      <a
                        // href={link.href}
                        className="w-min text-[#333333] lg:leading-[24px] md:leading-[22px] leading-[20px] font-regular lg:text-[16px] md:text-[15px] text-[14px] hover:text-black transition-colors duration-200 block lg:py-1 py-0.5"
                      >
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Company Links */}
              <div>
                <h3 className="text-[#333333]/50 lg:leading-[24px] md:leading-[22px] leading-[20px] font-regular lg:text-[16px] md:text-[15px] text-[14px] lg:mb-3 md:mb-2 mb-2">Company</h3>
                <ul className="lg:space-y-2 md:space-y-1 space-y-1">
                  {companyLinks.map((link) => (
                    <li key={link.name}>
                      <a
                        // href={link.href}
                        className="text-[#333333] lg:leading-[24px] md:leading-[22px] leading-[20px] font-regular lg:text-[16px] md:text-[15px] text-[14px] hover:text-black transition-colors duration-200 block lg:py-1 py-0.5"
                      >
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Resources Links */}
              {/* <div>
                <h3 className="text-[#333333]/50 lg:leading-[24px] md:leading-[22px] leading-[20px] font-regular lg:text-[16px] md:text-[15px] text-[14px] lg:mb-3 md:mb-2 mb-2">Resources</h3>
                <ul className="lg:space-y-2 md:space-y-1 space-y-1">
                  {resourceLinks.map((link) => (
                    <li key={link.name}>
                      <a
                        // href={link.href}
                        className="text-[#333333] lg:leading-[24px] md:leading-[22px] leading-[20px] font-regular lg:text-[16px] md:text-[15px] text-[14px] hover:text-black transition-colors duration-200 block lg:py-1 py-0.5"
                      >
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div> */}

              {/* Policies Links */}
              <div>
                <h3 className="text-[#333333]/50 lg:leading-[24px] md:leading-[22px] leading-[20px] font-regular lg:text-[16px] md:text-[15px] text-[14px] lg:mb-3 md:mb-2 mb-2">Policies</h3>
                <ul className="lg:space-y-2 md:space-y-1 space-y-1">
                  {policiesLinks.map((link) => (
                    <li key={link.name}>
                      <a
                        // href={link.href}
                        className="text-[#333333] lg:leading-[24px] md:leading-[22px] leading-[20px] font-regular lg:text-[16px] md:text-[15px] text-[14px] hover:text-black transition-colors duration-200 block lg:py-1 py-0.5"
                      >
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

            </div>}
          </div>
        </div>

      </div>
    </footer>
  );
}