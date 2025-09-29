'use client'

import { useEffect, useRef, Suspense } from 'react'
import Lenis from 'lenis'
import { usePathname, useSearchParams } from 'next/navigation'

// Separate component for search params to handle suspense
function ScrollToTop() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (window.lenis) {
      window.lenis.scrollTo(0, { immediate: true })
    }
  }, [pathname, searchParams])

  return null
}

export default function SmoothScrollProvider({ children }) {
  const lenisRef = useRef(null)

  useEffect(() => {
    // Initialize Lenis
    lenisRef.current = new Lenis({
      lerp: 0.1,          // Linear interpolation intensity (0-1)
      duration: 1.2,      // Duration of scroll animation
      smoothWheel: true,  // Enable smooth scrolling for mouse wheel
      smoothTouch: false, // Disable for touch devices (can cause issues)
      touchMultiplier: 2, // Touch scroll speed multiplier
      infinite: false,    // Disable infinite scrolling
      autoRaf: true,      // Automatically handle requestAnimationFrame
    })

    // Make Lenis instance globally accessible
    window.lenis = lenisRef.current

    // Handle window resize
    const handleResize = () => {
      lenisRef.current?.resize()
    }

    window.addEventListener('resize', handleResize)

    // Optional: Log scroll events for debugging
    lenisRef.current.on('scroll', ({ scroll, limit, velocity, direction, progress }) => {
      // console.log('Scroll:', { scroll, limit, velocity, direction, progress })
    })

    // Cleanup function
    return () => {
      lenisRef.current?.destroy()
      window.removeEventListener('resize', handleResize)
      delete window.lenis
    }
  }, [])

  return (
    <>
      <Suspense fallback={null}>
        <ScrollToTop />
      </Suspense>
      {children}
    </>
  )
}