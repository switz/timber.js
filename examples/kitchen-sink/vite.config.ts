import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { timber } from '../../packages/timber-app/src/index';

// Workspace root — two levels up from examples/kitchen-sink/
const root = resolve(import.meta.dirname, '../..');

export default defineConfig({
  plugins: [tailwindcss(), timber({ pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'] })],
  root: import.meta.dirname,
  server: {
    port: 3003,
    strictPort: true,
    cors: false,
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
    },
  },
});
