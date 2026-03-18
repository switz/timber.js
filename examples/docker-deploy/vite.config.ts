import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { timber } from '../../packages/timber-app/src/index';

const root = resolve(import.meta.dirname, '../..');

export default defineConfig({
  plugins: [timber()],
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@timber-js/app/cache': resolve(root, 'packages/timber-app/src/cache/index.ts'),
      '@timber-js/app/server': resolve(root, 'packages/timber-app/src/server/index.ts'),
      '@timber-js/app/client': resolve(root, 'packages/timber-app/src/client/index.ts'),
      '@timber-js/app/adapters/nitro': resolve(root, 'packages/timber-app/src/adapters/nitro.ts'),
      '@timber-js/app': resolve(root, 'packages/timber-app/src/index.ts'),
    },
  },
});
