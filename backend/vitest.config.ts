import {defineConfig} from 'vitest/config';

export default defineConfig({
  // The repo root holds the Next.js frontend's `postcss.config.mjs`. Vite walks upward looking for one
  // and then fails to load the Tailwind plugin in a Node context, so pin an empty PostCSS config here.
  css: {postcss: {plugins: []}},
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // config.ts validates and exits at import time; supply a valid inert environment first.
    setupFiles: ['test/setup.ts'],
  },
});
