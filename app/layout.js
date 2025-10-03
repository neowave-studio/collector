import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import Navbar from "./components/Navbar";
import SmoothScrollProvider from "./components/SmoothScrollProvider";
import FooterSection from "./components/Footer";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "Collector - Unified AI Messenger | All Your Chats in One Place",
  description: "The next generation AI messenger that unifies Discord, Telegram, and all your messaging platforms into one seamless service suite. Smart summaries, unified tasks, and intelligent inbox management.",
  
  // Open Graph metadata for social sharing (WhatsApp, Facebook, etc.)
  openGraph: {
    title: "Collector - Unified AI Messenger",
    description: "Unify Discord, Telegram, and all messaging platforms with AI-powered smart summaries and unified task management.",
    url: "https://Collector-messenger.com", // Update with your actual domain
    siteName: "Collector",
    images: [
      {
        url: "/Collector-og.png", // Create a proper OG image for social sharing
        width: 1200,
        height: 630,
        alt: "Collector - Unified AI Messenger",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  
  // Twitter Card metadata
  twitter: {
    card: "summary_large_image",
    title: "Collector - Unified AI Messenger",
    description: "All your chats in one place. Discord, Telegram, and more - unified with AI intelligence.",
    images: ["/Collector-twitter.png"], // Create Twitter card image
    creator: "@Collector_app", // Update with your Twitter handle
  },
  
  // Keywords for SEO
  keywords: [
    "unified messenger",
    "AI chat app",
    "Discord integration",
    "Telegram integration",
    "messaging platform",
    "chat unification",
    "smart summary",
    "unified inbox",
    "AI messenger",
    "cross-platform chat",
    "messaging hub"
  ],
  
  // Favicon setup
  icons: {
    icon: "/favicon.svg", // Your Collector favicon
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  
  // Web app manifest
  manifest: "/site.webmanifest",
  
  // Additional meta tags for better SEO
  other: {
    "application-name": "Collector",
    "msapplication-TileColor": "#3474FF", // Your brand blue color
    "msapplication-config": "/browserconfig.xml",
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Essential favicon links */}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-title" content="Collector" />
        <link rel="manifest" href="/site.webmanifest" />
        
        {/* Theme colors matching your brand */}
        <meta name="theme-color" content="#3474FF" />
        <meta name="msapplication-TileColor" content="#3474FF" />
        
        {/* Preload critical assets */}
        <link rel="preload" href="/Collector.svg" as="image" />
        <link rel="preload" href="/heroicons.png" as="image" />
        
        {/* Security headers */}
        <meta name="referrer" content="origin-when-cross-origin" />
        
        {/* PWA capabilities */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className={`${inter.variable} font-inter antialiased`}>
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-screen bg-[#ddefff]">
            <div className="animate-pulse">
              <img src="/Collector.svg" alt="Loading..." className="w-16 h-16" />
            </div>
          </div>
        }>
          <SmoothScrollProvider>
            <Navbar />
            {children}
            {/* <FooterSection /> */}
          </SmoothScrollProvider>
        </Suspense>
      </body>
    </html>
  );
}