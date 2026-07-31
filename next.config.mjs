// Where the Fastify API lives, as seen from *this server process* — not from the browser. Unset in
// local development, where the browser talks to http://localhost:8080 directly.
// Render's `fromService` blueprint property yields a bare `host:port` with no scheme, so normalise
// rather than making the deployer hand-write the origin.
const rawBackend = process.env.BACKEND_INTERNAL_URL?.trim().replace(/\/+$/, "");
const BACKEND_ORIGIN = rawBackend
  ? /^https?:\/\//.test(rawBackend)
    ? rawBackend
    : `http://${rawBackend}`
  : undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Same-origin proxy for the API.
   *
   * `onrender.com` is on the Public Suffix List, so `app.onrender.com` and `api.onrender.com` are
   * different *registrable* domains — cross-site. The session cookie is `SameSite=Lax`, so the
   * browser would drop it on every API call: sign-in appears to succeed, then everything 401s.
   *
   * Routing the API under this app's own origin makes the cookie first-party again, and costs no
   * domain purchase. `NEXT_PUBLIC_API_URL=/api` points the client (app/lib/api.js) here.
   *
   * The destination is the *internal* address where private networking is available, but any
   * reachable URL works — the browser never sees it either way, which is the whole point.
   */
  async rewrites() {
    if (!BACKEND_ORIGIN) return [];
    return [{source: "/api/:path*", destination: `${BACKEND_ORIGIN}/:path*`}];
  },

  turbopack: {
    resolveAlias: {
      // `@coinbase/cdp-sdk` arrives transitively via wagmi's Base Account connector and statically
      // imports its Solana / x402 payment paths. This app is EVM-only, so those are unreachable at
      // runtime — but the bundler still has to resolve them. See stubs/empty.js.
      '@x402/svm/exact/client': './stubs/empty.js',
      accounts: './stubs/empty.js',
    },
  },
};

export default nextConfig;
