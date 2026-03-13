import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const root = import.meta.dirname!;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)/, replacement: resolve(root, 'packages/timber-app/src/$1') },
      { find: '@timber/app/cache', replacement: resolve(root, 'packages/timber-app/src/cache/index.ts') },
      { find: '@timber/app/server', replacement: resolve(root, 'packages/timber-app/src/server/index.ts') },
      { find: '@timber/app/client/nuqs-adapter', replacement: resolve(root, 'packages/timber-app/src/client/nuqs-adapter.tsx') },
      { find: '@timber/app/client/router-ref', replacement: resolve(root, 'packages/timber-app/src/client/router-ref.ts') },
      { find: '@timber/app/client', replacement: resolve(root, 'packages/timber-app/src/client/index.ts') },
      { find: '@timber/app/routing', replacement: resolve(root, 'packages/timber-app/src/routing/index.ts') },
      { find: '@timber/app/adapters/cloudflare', replacement: resolve(root, 'packages/timber-app/src/adapters/cloudflare.ts') },
      { find: '@timber/app/adapters/types', replacement: resolve(root, 'packages/timber-app/src/adapters/types.ts') },
      { find: '@timber/app/search-params', replacement: resolve(root, 'packages/timber-app/src/search-params/index.ts') },
      { find: '@timber/app', replacement: resolve(root, 'packages/timber-app/src/index.ts') },
    ],
  },
  test: {
    testTimeout: 30_000,
    pool: 'forks',
    exclude: ['tests/e2e/**', 'examples/*/e2e/**', '**/node_modules/**'],
  },
});
