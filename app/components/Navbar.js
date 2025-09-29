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
        ? 'bg-black/95 backdrop-blur-lg shadow-lg' 
        : 'bg-black'
    }`}>
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="flex items-center justify-between h-20">
          
          {/* Logo */}
          <div className="flex items-center">
            <a href="/" onClick={(e) => { e.preventDefault(); handleNavigation('/'); }} className="flex items-center">
              <img
                src="/logo.svg"
                alt="Logo"
                className="h-12 w-12"
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
                className="text-[15px] text-white font-normal tracking-wide transition-all duration-300 hover:text-gray-300 relative"
              >
                {item.name}
              </a>
            ))}
          </div>

          {/* Connect Wallet Button */}
          <div className="hidden lg:flex items-center">
            <button 
              onClick={() => handleNavigation('/connect')}
              className="px-6 py-2.5 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 text-[15px] rounded-lg transition-all duration-300 shadow-lg hover:shadow-emerald-600/50"
            >
              Connect Wallet
            </button>
          </div>

          {/* Mobile Menu Button */}
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden text-white p-2"
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
        <div className={`lg:hidden overflow-hidden transition-all duration-300 ${
          isMobileMenuOpen ? 'max-h-96 opacity-100 pb-4' : 'max-h-0 opacity-0'
        }`}>
          <div className="flex flex-col space-y-4 pt-4">
            {navItems.map((item) => (
              <a
                key={item.name}
                href={item.href}
                onClick={(e) => { 
                  e.preventDefault(); 
                  handleNavigation(item.href); 
                }}
                className="text-white hover:text-gray-300 transition-colors py-2"
              >
                {item.name}
              </a>
            ))}
            <button 
              onClick={() => handleNavigation('/connect')}
              className="px-6 py-2.5 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-all duration-300 text-center"
            >
              Connect Wallet
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}