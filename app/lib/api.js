"use client";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/**
 * Backend client.
 *
 * `credentials: "include"` carries the HttpOnly session cookie. Note what that session is and is not:
 * it authenticates *who is asking*, but it never authorises a payment on its own — every rip and
 * buyback additionally needs the user's own EIP-712 signature over the exact terms, verified
 * on-chain. A stolen session can browse; it cannot spend.
 */
async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = new Error(body?.detail ?? body?.error ?? `Request failed (${res.status})`);
    err.code = body?.error;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  chains: () => request("/chains"),
  packs: () => request("/packs"),
  reserves: () => request("/reserves"),
  session: () => request("/auth/session"),

  nonce: () => request("/auth/nonce"),
  verify: (message, signature) =>
    request("/auth/verify", { method: "POST", body: JSON.stringify({ message, signature }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  attestAge: (confirmedAtLeast) =>
    request("/auth/attest-age", {
      method: "POST",
      body: JSON.stringify({ confirmedAtLeast }),
    }),
  selfExclude: (days) =>
    request("/auth/self-exclude", { method: "POST", body: JSON.stringify({ days }) }),

  ripQuote: (chainId, packId, numRips) =>
    request("/rip/quote", { method: "POST", body: JSON.stringify({ chainId, packId, numRips }) }),
  rip: (payload) => request("/rip", { method: "POST", body: JSON.stringify(payload) }),

  draw: (chainId, drawId) => request(`/draws/${chainId}/${drawId}`),
  myDraws: () => request("/me/draws"),
  selfSettle: (chainId, drawId) => request(`/draws/${chainId}/${drawId}/self-settle`),

  /** Delivers a revealed draw now instead of waiting out the buyback window. */
  settleDraw: (chainId, drawId) =>
    request(`/draws/${drawId}/settle?chainId=${chainId}`, { method: "POST" }),

  buybackQuote: (chainId, drawId) =>
    request("/buyback/quote", { method: "POST", body: JSON.stringify({ chainId, drawId }) }),
  buyback: (chainId, drawId, signature, acceptedPayout) =>
    request("/buyback", {
      method: "POST",
      body: JSON.stringify({ chainId, drawId, signature, acceptedPayout }),
    }),

  moonpayUrl: (chainId, fiatAmount) =>
    request("/moonpay/widget-url", {
      method: "POST",
      body: JSON.stringify({ chainId, fiatAmount, flow: "onramp" }),
    }),

  // --- marketplace ---------------------------------------------------------------------------
  listings: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
    ).toString();
    return request(`/listings${q ? `?${q}` : ""}`);
  },
  prepareListing: (payload) =>
    request("/listings/prepare", { method: "POST", body: JSON.stringify(payload) }),
  publishListing: (payload) =>
    request("/listings", { method: "POST", body: JSON.stringify(payload) }),
  cancelListing: (id) => request(`/listings/${id}`, { method: "DELETE" }),
  myCards: () => request("/me/cards"),
  marketplaceConfig: () => request("/marketplace/config"),
  card: (chainId, tokenId) => request(`/cards/${chainId}/${tokenId}`),
  user: (address) => request(`/users/${address}`),
  leaderboard: (chainId) =>
    request(`/leaderboard${chainId ? `?chainId=${chainId}` : ""}`),

  poolFile: (chainId, packId, version) =>
    request(`/packs/${chainId}/${packId}/${version}/pool-file`),
};

/** Formats a uint256 token amount for display without going through Number. */
export function formatUnits(value, decimals = 6, maxFractionDigits = 2) {
  if (value === null || value === undefined) return "—";
  const str = String(value);
  const negative = str.startsWith("-");
  const raw = BigInt(negative ? str.slice(1) : str);
  const base = 10n ** BigInt(decimals);

  const whole = (raw / base).toLocaleString("en-US");
  const fraction = (raw % base)
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFractionDigits)
    .replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
