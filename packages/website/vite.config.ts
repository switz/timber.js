import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { timber } from '../../packages/timber-app/src/index';

// Workspace root — two levels up from packages/website/
const root = resolve(import.meta.dirname, '../..');

export default defineConfig({
  plugins: [timber(), tailwindcss()],
  root: import.meta.dirname,
  server: {
    port: 3010,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@timber-js/app/cache': resolve(root, 'packages/timber-app/src/cache/index.ts'),
      '@timber-js/app/server': resolve(root, 'packages/timber-app/src/server/index.ts'),
      '@timber-js/app/client': resolve(root, 'packages/timber-app/src/client/index.ts'),
      '@timber-js/app/content': resolve(root, 'packages/timber-app/src/content/index.ts'),
      '@timber-js/app/routing': resolve(root, 'packages/timber-app/src/routing/index.ts'),
      '@timber-js/app/search-params': resolve(
        root,
        'packages/timber-app/src/search-params/index.ts'
      ),
      '@timber-js/app': resolve(root, 'packages/timber-app/src/index.ts'),
      '@timber-js/app/adapters/cloudflare': resolve(
        root,
        'packages/timber-app/src/adapters/cloudflare.ts'
      ),
      '@': import.meta.dirname,
    },
  },
});
