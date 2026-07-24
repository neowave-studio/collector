"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveal — animates its children in (fade + slide) the first time they enter
 * the viewport. Above-the-fold content is gated on the PageLoader's
 * "collector:revealed" event, so the hero cascades in exactly as the loader
 * curtains part; below-the-fold content animates as you scroll to it.
 *
 * Props: delay (ms), y / x (px offset), threshold, once, as (tag).
 */
export default function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  y = 26,
  x = 0,
  threshold = 0.12,
  once = true,
  className = "",
  style,
  ...rest
}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reduced motion: show immediately, no animation.
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setShown(true);
      return;
    }

    let intersected = false;
    let revealed = window.__collectorRevealed === true;
    let done = false;

    const maybeShow = () => {
      if (done) return;
      if (intersected && revealed) {
        done = true;
        setShown(true);
      }
    };

    const onRevealed = () => {
      revealed = true;
      maybeShow();
    };
    if (!revealed) window.addEventListener("collector:revealed", onRevealed);

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            intersected = true;
            maybeShow();
            if (once) io.unobserve(entry.target);
          }
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);

    // Safety net — never leave content hidden if a signal never arrives.
    const fallback = setTimeout(() => {
      intersected = true;
      revealed = true;
      maybeShow();
    }, 6000);

    return () => {
      io.disconnect();
      window.removeEventListener("collector:revealed", onRevealed);
      clearTimeout(fallback);
    };
  }, [once, threshold]);

  return (
    <Tag
      ref={ref}
      className={`reveal ${shown ? "reveal-in" : ""} ${className}`.trim()}
      style={{
        "--reveal-delay": `${delay}ms`,
        "--reveal-y": `${y}px`,
        "--reveal-x": `${x}px`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
