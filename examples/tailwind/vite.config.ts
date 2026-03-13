import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { timber } from '../../packages/timber-app/src/index';
import tailwindcss from '@tailwindcss/vite';

// Workspace root — two levels up from examples/tailwind/
const root = resolve(import.meta.dirname, '../..');

export default defineConfig({
  plugins: [timber(), tailwindcss()],
  root: import.meta.dirname,
  server: {
    port: 3002,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@timber/app/cache': resolve(root, 'packages/timber-app/src/cache/index.ts'),
      '@timber/app/server': resolve(root, 'packages/timber-app/src/server/index.ts'),
      '@timber/app/client': resolve(root, 'packages/timber-app/src/client/index.ts'),
      '@timber/app/content': resolve(root, 'packages/timber-app/src/content/index.ts'),
      '@timber/app/routing': resolve(root, 'packages/timber-app/src/routing/index.ts'),
      '@timber/app/search-params': resolve(root, 'packages/timber-app/src/search-params/index.ts'),
      '@timber/app': resolve(root, 'packages/timber-app/src/index.ts'),
    },
  },
});
