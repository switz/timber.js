// Vite library mode config for building @timber/app for npm distribution.
// Produces compiled ESM in dist/ — declaration files are generated separately via tsc.
// See design/28-npm-packaging.md for rationale.

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        'index': 'src/index.ts',
        'server/index': 'src/server/index.ts',
        'client/index': 'src/client/index.ts',
        'cache/index': 'src/cache/index.ts',
        'content/index': 'src/content/index.ts',
        'cookies/index': 'src/cookies/index.ts',
        'search-params/index': 'src/search-params/index.ts',
        'routing/index': 'src/routing/index.ts',
        'adapters/cloudflare': 'src/adapters/cloudflare.ts',
        'adapters/nitro': 'src/adapters/nitro.ts',
        'cli': 'src/cli.ts',
      },
      formats: ['es'],
    },
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    // Preserve module structure — don't bundle everything into a single file
    minify: false,
    rollupOptions: {
      external: [
        // Peer dependencies
        'react',
        'react-dom',
        'react-dom/server',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'vite',
        'nuqs',
        'zod',
        // Peer dependencies (Vite ecosystem — must resolve from consumer for pnpm link)
        '@vitejs/plugin-rsc',
        '@vitejs/plugin-react',
        // Direct dependencies
        '@opentelemetry/api',
        '@opentelemetry/context-async-hooks',
        '@opentelemetry/sdk-trace-base',
        // Optional peer dependencies
        '@content-collections/core',
        '@content-collections/mdx',
        '@content-collections/vite',
        '@mdx-js/rollup',
        // Node.js built-ins
        /^node:/,
      ],
      output: {
        // Preserve export names for clean import paths
        preserveModules: false,
        // Ensure .js extension for ESM
        entryFileNames: '[name].js',
        chunkFileNames: '_chunks/[name]-[hash].js',
      },
    },
  },
});
