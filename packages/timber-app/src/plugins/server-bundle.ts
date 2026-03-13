/**
 * timber-server-bundle — Bundle all dependencies for server environments.
 *
 * In production builds, sets `resolve.noExternal: true` for the rsc and ssr
 * environments. This ensures all npm dependencies are bundled into the output,
 * which is required for platforms like Cloudflare Workers that don't have
 * access to node_modules at runtime.
 *
 * In dev mode, Vite's default externalization is preserved for fast HMR.
 *
 * Design docs: design/11-platform.md, design/25-production-deployments.md
 */

import type { Plugin } from 'vite';

export function timberServerBundle(): Plugin {
  return {
    name: 'timber-server-bundle',

    config(_cfg, { command }) {
      if (command !== 'build') return;

      // Bundle all dependencies in server environments for production.
      // Without this, bare imports like 'nuqs/adapters/custom' are left
      // as external imports in the output, which fails on platforms
      // without node_modules (Cloudflare Workers, edge runtimes).
      // Define process.env.NODE_ENV in server environments so that
      // dead-code branches (dev-only tracing, React dev checks) are
      // eliminated by Rollup's tree-shaking. Without this, the runtime
      // check falls through on platforms where process.env is empty
      // (e.g. Cloudflare Workers), causing dev code to run in production.
      const serverDefine = {
        'process.env.NODE_ENV': JSON.stringify('production'),
      };

      return {
        environments: {
          rsc: {
            resolve: { noExternal: true },
            define: serverDefine,
          },
          ssr: {
            resolve: { noExternal: true },
            define: serverDefine,
          },
        },
      };
    },
  };
}
