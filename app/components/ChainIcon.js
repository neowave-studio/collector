"use client";

/**
 * Network marks, drawn inline.
 *
 * Inline SVG rather than hosted logo files on purpose: an icon fetched from a CDN is a third-party
 * request on every page load, breaks under a strict CSP, and shows a broken image exactly when the
 * network is having a bad day — which is the moment a user most needs to see which chain they are on.
 * These are a few hundred bytes each and always render.
 *
 * Anything without a mark falls back to a coloured disc bearing the chain's initial, so a chain added
 * to the registry tomorrow still looks deliberate rather than missing.
 */

const BRAND = {
  8453: "#0052FF", // Base
  84532: "#0052FF", // Base Sepolia
  56: "#F3BA2F", // BNB Chain
  97: "#F3BA2F", // BNB testnet
  1: "#627EEA", // Ethereum
  11155111: "#627EEA", // Sepolia
  137: "#8247E5", // Polygon
  42161: "#213147", // Arbitrum
  31337: "#8A8F98", // local devnet
};

function Base({size}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#0052FF" />
      {/* Base's mark: a disc with a squared-off right edge. */}
      <path
        d="M15.6 26.4c5.9 0 10.7-4.7 10.7-10.4S21.5 5.6 15.6 5.6c-5.6 0-10.2 4.2-10.7 9.6h14.2v1.6H4.9c.5 5.4 5.1 9.6 10.7 9.6z"
        fill="#fff"
      />
    </svg>
  );
}

function Bnb({size}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
      <g fill="#fff">
        <path d="M16 6.6l2.7 2.8L13.3 15l-2.7-2.8L16 6.6z" />
        <path d="M20.1 10.7l2.7 2.8-9.5 9.9-2.7-2.8 9.5-9.9z" transform="translate(0 -3.3)" />
        <path d="M8.6 14.8l2.7 2.8-2.7 2.8-2.7-2.8 2.7-2.8z" />
        <path d="M23.4 14.8l2.7 2.8-2.7 2.8-2.7-2.8 2.7-2.8z" />
        <path d="M16 19.9l2.7 2.8-2.7 2.8-2.7-2.8 2.7-2.8z" />
      </g>
    </svg>
  );
}

function Ethereum({size}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <g fill="#fff">
        <path d="M16.2 4v8.9l7.5 3.3L16.2 4z" fillOpacity="0.6" />
        <path d="M16.2 4L8.7 16.2l7.5-3.3V4z" />
        <path d="M16.2 21.9v6.1l7.5-10.4-7.5 4.3z" fillOpacity="0.6" />
        <path d="M16.2 28v-6.1l-7.5-4.3L16.2 28z" />
        <path d="M16.2 20.5l7.5-4.3-7.5-3.3v7.6z" fillOpacity="0.2" />
        <path d="M8.7 16.2l7.5 4.3v-7.6l-7.5 3.3z" fillOpacity="0.6" />
      </g>
    </svg>
  );
}

function Polygon({size}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#8247E5" />
      <path
        d="M21.1 12.9c-.4-.2-.9-.2-1.3 0l-3 1.7-2 1.1-2.9 1.7c-.4.2-.9.2-1.3 0l-2.3-1.3a1.3 1.3 0 01-.7-1.1v-2.6c0-.5.2-.9.7-1.1l2.3-1.3c.4-.2.9-.2 1.3 0l2.3 1.3c.4.2.7.6.7 1.1v1.7l2-1.2v-1.7c0-.4-.2-.9-.7-1.1l-4.2-2.5c-.4-.2-.9-.2-1.3 0L6.3 10c-.5.2-.7.7-.7 1.1v4.9c0 .5.2.9.7 1.1l4.3 2.5c.4.2.9.2 1.3 0l2.9-1.7 2-1.2 2.9-1.7c.4-.2.9-.2 1.3 0l2.3 1.3c.4.2.7.6.7 1.1v2.6c0 .5-.2.9-.7 1.1l-2.3 1.4c-.4.2-.9.2-1.3 0l-2.3-1.3a1.3 1.3 0 01-.7-1.1v-1.7l-2 1.2v1.7c0 .5.2.9.7 1.1l4.3 2.5c.4.2.9.2 1.3 0l4.3-2.5c.4-.2.7-.6.7-1.1v-5c0-.5-.2-.9-.7-1.1l-4.3-2.4z"
        fill="#fff"
      />
    </svg>
  );
}

function Arbitrum({size}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#213147" />
      <path d="M16 6l7 12.1-2.6 1.5L16 11.2l-4.4 8.4L9 18.1 16 6z" fill="#12AAFF" />
      <path d="M18.6 21.6l1.7 3-2.6 1.5-1.7-3 2.6-1.5zM13.4 21.6l-1.7 3-2.6-1.5 1.7-3 2.6 1.5z" fill="#9DCCED" />
    </svg>
  );
}

const MARKS = {
  8453: Base,
  84532: Base,
  56: Bnb,
  97: Bnb,
  1: Ethereum,
  11155111: Ethereum,
  137: Polygon,
  42161: Arbitrum,
};

export default function ChainIcon({chainId, name = "", size = 18, className = ""}) {
  const Mark = MARKS[chainId];
  if (Mark) {
    return (
      <span className={`inline-flex shrink-0 ${className}`}>
        <Mark size={size} />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 rounded-full text-white font-bold ${className}`}
      style={{
        width: size,
        height: size,
        background: BRAND[chainId] ?? "#8A8F98",
        fontSize: size * 0.5,
      }}
      aria-hidden="true"
    >
      {(name[0] ?? "?").toUpperCase()}
    </span>
  );
}
