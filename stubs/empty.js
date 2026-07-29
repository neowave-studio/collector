/**
 * Empty module used to satisfy optional imports we deliberately do not ship.
 *
 * `@coinbase/cdp-sdk` (reached transitively through wagmi's Base Account connector) statically
 * imports its Solana and x402 payment paths. We are an EVM-only application, so those code paths are
 * unreachable at runtime — but a bundler still has to resolve the specifiers. Aliasing them here is
 * the narrow fix; installing the Solana SDK to satisfy an import nothing calls would be the wrong one.
 *
 * If a legitimate feature ever needs one of these, remove its alias from `next.config.mjs` and install
 * the real package — the build will tell you immediately.
 */
export default {};
