import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const root = import.meta.dirname!;

export default defineConfig({
  resolve: {
    alias: {
      '@timber/app/cache': resolve(root, 'packages/timber-app/src/cache/index.ts'),
      '@timber/app/server': resolve(root, 'packages/timber-app/src/server/index.ts'),
      '@timber/app/client/nuqs-adapter': resolve(
        root,
        'packages/timber-app/src/client/nuqs-adapter.tsx'
      ),
      '@timber/app/client/router-ref': resolve(
        root,
        'packages/timber-app/src/client/router-ref.ts'
      ),
      '@timber/app/client': resolve(root, 'packages/timber-app/src/client/index.ts'),
      '@timber/app/routing': resolve(root, 'packages/timber-app/src/routing/index.ts'),
      '@timber/app/adapters/cloudflare': resolve(
        root,
        'packages/timber-app/src/adapters/cloudflare.ts'
      ),
      '@timber/app/adapters/types': resolve(root, 'packages/timber-app/src/adapters/types.ts'),
      '@timber/app/search-params': resolve(root, 'packages/timber-app/src/search-params/index.ts'),
      '@timber/app': resolve(root, 'packages/timber-app/src/index.ts'),
    },
  },
  test: {
    testTimeout: 30_000,
    pool: 'forks',
    exclude: ['tests/e2e/**', 'examples/*/e2e/**', '**/node_modules/**'],
  },
});
