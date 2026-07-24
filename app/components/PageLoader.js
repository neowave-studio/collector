"use client";

import { useEffect, useRef, useState } from "react";

const LOAD_DURATION = 1650; // ms to fill 0 -> 100
const HOLD_AFTER_FULL = 240; // ms to sit at 100% before the reveal
const REVEAL_DURATION = 950; // ms for the curtains to part (matches CSS)

// easeOutCubic — fast then settles, reads as a real load
const ease = (t) => 1 - Math.pow(1 - t, 3);

export default function PageLoader() {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("loading"); // "loading" | "revealing" | "done"
  const rafRef = useRef(null);
  const startRef = useRef(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    let cancelled = false;
    const timers = [];

    const tick = (now) => {
      if (startRef.current == null) startRef.current = now;
      const t = Math.min((now - startRef.current) / LOAD_DURATION, 1);
      if (!cancelled) setProgress(Math.round(ease(t) * 100));

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Hit 100% — hold briefly, then part the curtains, then unmount.
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setPhase("revealing");
          document.body.style.overflow = prevOverflow;
          // Signal the page that curtains are parting so content can cascade in.
          window.__collectorRevealed = true;
          window.dispatchEvent(new Event("collector:revealed"));
          timers.push(
            setTimeout(() => {
              if (!cancelled) setPhase("done");
            }, REVEAL_DURATION)
          );
        }, HOLD_AFTER_FULL)
      );
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      timers.forEach(clearTimeout);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div className={`loader-overlay ${phase}`} aria-hidden="true">
      <div className="loader-curtain loader-curtain-top" />
      <div className="loader-curtain loader-curtain-bottom" />

      <div className="loader-stage">
        <div className="loader-glow loader-glow-a" />
        <div className="loader-glow loader-glow-b" />

        <div className="loader-emblem-wrap">
          <div className="loader-ring-glow" />
          <div className="loader-ring" />
          <img src="/logo.svg" alt="" className="loader-emblem" draggable="false" />
        </div>

        <div className="loader-wordmark">Collector</div>

        <div className="loader-progress">
          <div className="loader-bar">
            <div className="loader-bar-fill" style={{ width: `${progress}%` }} />
            <div className="loader-bar-shine" />
          </div>
          <div className="loader-percent">{String(progress).padStart(2, "0")}%</div>
        </div>
      </div>
    </div>
  );
}
