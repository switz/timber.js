import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { timber } from '../../packages/timber-app/src/index';
import type { CodeHikeConfig } from 'codehike/mdx';
import remarkCodehike from 'remark-codehike';
import recmaCodehike from 'recma-codehike';

// Workspace root — two levels up from examples/next-playground-migration/
const root = resolve(import.meta.dirname, '../..');

const codeHikeConfig = {
  components: { code: 'MyCode', inlineCode: 'MyInlineCode' },
} satisfies CodeHikeConfig;

export default defineConfig({
  plugins: [
    // MDX config must be passed inline (not via timber.config.ts) because the
    // MDX plugin reads ctx.config at build time, before timber.config.ts is loaded.
    // See timber-abu for the fix. Plugins must be imported functions, not string names.
    timber({
      pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'],
      mdx: {
        remarkPlugins: [[remarkCodehike, codeHikeConfig]],
        recmaPlugins: [[recmaCodehike, codeHikeConfig]],
      },
    }),
  ],
  root: import.meta.dirname,
  server: {
    port: 3004,
    strictPort: true,
  },
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      // Workspace source aliases
      '@timber/app/cache': resolve(root, 'packages/timber-app/src/cache/index.ts'),
      '@timber/app/server': resolve(root, 'packages/timber-app/src/server/index.ts'),
      '@timber/app/client': resolve(root, 'packages/timber-app/src/client/index.ts'),
      '@timber/app/content': resolve(root, 'packages/timber-app/src/content/index.ts'),
      '@timber/app/routing': resolve(root, 'packages/timber-app/src/routing/index.ts'),
      '@timber/app/search-params': resolve(root, 'packages/timber-app/src/search-params/index.ts'),
      '@timber/app': resolve(root, 'packages/timber-app/src/index.ts'),
      // App-local path alias (replaces Next.js #/ convention)
      '#': resolve(import.meta.dirname),
    },
  },
});
