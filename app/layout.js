import { GeistSans } from 'geist/font/sans';
import { Suspense } from "react";
import "./globals.css";
import Navbar from "./components/Navbar";
import SmoothScrollProvider from "./components/SmoothScrollProvider";
import PageLoader from "./components/PageLoader";
import HoloBackground from "./components/home/HoloBackground";
import Web3Provider from "./providers/Web3Provider";

export const metadata = {
  title: "Collector - Trade & Collect Pokemon Cards | NFT Marketplace",
  description: "The ultimate Pokemon card trading platform. Collect, trade, and discover rare Pokemon cards in a secure marketplace with verified grading and authentication.",
  
  // Open Graph metadata for social sharing
  openGraph: {
    title: "Collector - Pokemon Card Trading Marketplace",
    description: "Collect and trade authentic Pokemon cards. Browse graded cards, make offers, and build your dream collection.",
    url: "https://collector-cards.com", // Update with your actual domain
    siteName: "Collector",
    images: [
      {
        url: "/collector-og.png", // Create a proper OG image
        width: 1200,
        height: 630,
        alt: "Collector - Pokemon Card Trading Marketplace",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  
  // Twitter Card metadata
  twitter: {
    card: "summary_large_image",
    title: "Collector - Pokemon Card Trading Marketplace",
    description: "Trade and collect authenticated Pokemon cards. PSA graded, verified, and secure.",
    images: ["/collector-twitter.png"],
    creator: "@collector_cards", // Update with your Twitter handle
  },
  
  // Keywords for SEO
  keywords: [
    "pokemon cards",
    "trading cards",
    "card marketplace",
    "PSA graded cards",
    "pokemon card trading",
    "rare pokemon cards",
    "card collecting",
    "authenticated cards",
    "graded pokemon cards",
    "card NFT",
    "pokemon marketplace"
  ],
  
  // Favicon setup
  icons: {
    icon: "/favicon.svg",
  },
  
  // Web app manifest
  manifest: "/site.webmanifest",
  
  // Additional meta tags
  other: {
    "application-name": "Collector",
    "msapplication-TileColor": "#2BD383",
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Essential favicon links */}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <meta name="apple-mobile-web-app-title" content="Collector" />
        <link rel="manifest" href="/site.webmanifest" />
        
        {/* Theme colors */}
        <meta name="theme-color" content="#2BD383" />
        <meta name="msapplication-TileColor" content="#2BD383" />
        
        {/* Preload critical assets */}
        <link rel="preload" href="/logo.svg" as="image" />
        
        {/* Security headers */}
        <meta name="referrer" content="origin-when-cross-origin" />
        
        {/* PWA capabilities */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className={`${GeistSans.className} antialiased bg-[#050706] text-white`}>
        <PageLoader />
        <HoloBackground />
        <Web3Provider>
          <Suspense fallback={<div className="min-h-screen bg-[#050706]" />}>
            <SmoothScrollProvider>
              <Navbar />
              <div className="relative z-10">{children}</div>
            </SmoothScrollProvider>
          </Suspense>
        </Web3Provider>
      </body>
    </html>
  );
}