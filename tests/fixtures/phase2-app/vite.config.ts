import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { timber } from '../../../packages/timber-app/src/index';

// Workspace root — three levels up from tests/fixtures/phase2-app/
const root = resolve(import.meta.dirname, '../../..');

export default defineConfig({
  plugins: [timber()],
  root: import.meta.dirname,
  server: {
    port: 3000,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@timber-js/app/cache': resolve(root, 'packages/timber-app/src/cache/index.ts'),
      '@timber-js/app/server': resolve(root, 'packages/timber-app/src/server/index.ts'),
      '@timber-js/app/client': resolve(root, 'packages/timber-app/src/client/index.ts'),
      '@timber-js/app/routing': resolve(root, 'packages/timber-app/src/routing/index.ts'),
      '@timber-js/app/search-params': resolve(
        root,
        'packages/timber-app/src/search-params/index.ts'
      ),
      '@timber-js/app': resolve(root, 'packages/timber-app/src/index.ts'),
    },
  },
});
