"use client";

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Function to handle navigation
  const handleNavigation = (href) => {
    setIsMobileMenuOpen(false);
    router.push(href);
  };

  const navItems = [
    { name: 'Gacha', href: '/gacha' },
    { name: 'Marketplace', href: '/marketplace' },
    { name: 'Leaderboard', href: '/leaderboard' },
    { name: 'How it Works', href: '/how-it-works' }
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      isScrolled
        ? 'py-2 bg-[#070a09]/70 backdrop-blur-2xl shadow-[0_12px_40px_-24px_rgba(0,0,0,0.9)]'
        : 'py-3 bg-[#070a09]/35 backdrop-blur-lg'
    }`}>
      <span className="nav-hairline pointer-events-none absolute inset-x-0 bottom-0 h-px" />
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="flex items-center justify-between h-20">
          
          {/* Logo */}
          <div className="flex items-center">
            <a href="/" onClick={(e) => { e.preventDefault(); handleNavigation('/'); }} className="flex items-center">
              <img
                src="/logo.svg"
                alt="Logo"
                className="h-12 w-12 hover-scale"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'block';
                }}
              />
              <div 
                className="hidden text-2xl font-bold text-white"
                style={{ display: 'none' }}
              >
                Logo
              </div>
            </a>
          </div>

          {/* Desktop Navigation - Centered */}
          <div className="hidden lg:flex items-center justify-center flex-1 space-x-12">
            {navItems.map((item) => (
              <a
                key={item.name}
                href={item.href}
                onClick={(e) => { 
                  e.preventDefault(); 
                  handleNavigation(item.href); 
                }}
                className="link-underline font-[500] text-[14px] text-white transition-all duration-300 hover:text-white relative"
              >
                {item.name}
              </a>
            ))}
          </div>

          {/* Connect Wallet Button */}
          <div className="hidden lg:flex items-center">
            <button 
              onClick={() => handleNavigation('/connect')}
              className="px-6 py-2.5 font-[700] text-[16px] text-white nav-active  rounded-[12px]  border border-[#FFFFFF47]  "
            >
              Connect Wallet
            </button>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden text-white p-2 rounded-xl glass-soft hover-scale"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isMobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="lg:hidden mt-3 nav-mobile-menu">
            <div className="glass-menu rounded-2xl p-4 flex flex-col space-y-1">
              {navItems.map((item) => (
                <a
                  key={item.name}
                  href={item.href}
                  onClick={(e) => {
                    e.preventDefault();
                    handleNavigation(item.href);
                  }}
                  className="text-white/85 hover:text-white hover:bg-white/[0.06] transition-colors py-2.5 px-3 rounded-xl text-[15px] font-medium"
                >
                  {item.name}
                </a>
              ))}
              <button
                onClick={() => handleNavigation('/connect')}
                className="mt-2 px-6 py-3 font-[700] text-[15px] text-white nav-active rounded-[14px] border border-[#FFFFFF47]"
              >
                Connect Wallet
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}