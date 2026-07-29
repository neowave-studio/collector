/** @type {import('next').NextConfig} */
const nextConfig = {
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
