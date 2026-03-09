import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@timber/app/cache': resolve(__dirname, 'packages/timber-app/src/cache/index.ts'),
      '@timber/app/server': resolve(__dirname, 'packages/timber-app/src/server/index.ts'),
      '@timber/app/client': resolve(__dirname, 'packages/timber-app/src/client/index.ts'),
      '@timber/app/adapters/cloudflare': resolve(__dirname, 'packages/timber-app/src/adapters/cloudflare.ts'),
      '@timber/app/adapters/types': resolve(__dirname, 'packages/timber-app/src/adapters/types.ts'),
      '@timber/app/search-params': resolve(__dirname, 'packages/timber-app/src/search-params/index.ts'),
      '@timber/app': resolve(__dirname, 'packages/timber-app/src/index.ts'),
    },
  },
  test: {
    testTimeout: 30_000,
    pool: 'forks',
  },
})
