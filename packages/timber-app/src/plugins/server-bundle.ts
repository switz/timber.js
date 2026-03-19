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

export function timberServerBundle(): Plugin[] {
  const bundlePlugin: Plugin = {
    name: 'timber-server-bundle',

    config(_cfg, { command }) {
      // In dev mode, Vite externalizes node_modules by default for fast HMR.
      // But server-only/client-only must NOT be externalized — they need to
      // go through the timber-shims plugin so it can replace them with no-op
      // virtual modules. Without this, deps like `bright` that import
      // `server-only` get the real CJS package loaded via Node's require(),
      // which throws in the SSR environment.
      if (command === 'serve') {
        // In dev, Vite externalizes node_modules and loads them via Node's
        // native require(). This causes two problems:
        //
        // 1. Poison-pill packages: deps that import `server-only` (like `bright`)
        //    hit the real CJS package which throws in the SSR environment.
        //
        // 2. Dual React instances: deps with React hooks (nuqs, etc.) are
        //    externalized and loaded via Node.js, getting their own copy of
        //    React. Meanwhile, SSR's renderToReadableStream uses Vite's
        //    dep-optimized React. Two React instances = dispatcher mismatch,
        //    causing "Invalid hook call" / "Cannot read properties of null
        //    (reading 'useId')" errors. See LOCAL-297.
        //
        // We force these packages to be non-external so they go through
        // Vite's module pipeline, which deduplicates React correctly.
        return {
          environments: {
            rsc: {
              resolve: {
                noExternal: ['server-only', 'client-only'],
              },
            },
            ssr: {
              resolve: {
                noExternal: ['server-only', 'client-only', 'nuqs'],
              },
            },
          },
        };
      }

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
        // Target webworker so Rolldown doesn't emit createRequire(import.meta.url)
        // shims that fail in Cloudflare Workers where import.meta.url is undefined
        // for non-entry modules. See design/11-platform.md.
        ssr: { target: 'webworker' },
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

  // Fix Rolldown's broken `__esmMin` lazy initializers in server bundles.
  //
  // Rolldown wraps ESM module initialization in `__esmMin` lazy functions.
  // For packages with `sideEffects: false` (e.g. nuqs), Rolldown drops
  // the variable assignment of the init function — so the module's React
  // imports, context creation, etc. never execute.
  //
  // The fix: patch the `__esmMin` runtime definition to eagerly execute
  // the init callback while still returning the lazy wrapper. This makes
  // all ESM module inits run at load time (standard ESM behavior) instead
  // of lazily, which is functionally correct and avoids the dropped-init bug.
  const esmInitFixPlugin: Plugin = {
    name: 'timber-esm-init-fix',
    applyToEnvironment(environment) {
      return environment.name === 'rsc' || environment.name === 'ssr';
    },
    renderChunk(code) {
      const lazy = 'var __esmMin = (fn, res) => () => (fn && (res = fn(fn = 0)), res);';
      if (!code.includes(lazy)) return null;

      // Replace with eager-then-lazy: execute init immediately, then
      // return the lazy wrapper for any subsequent calls (which are
      // idempotent since fn is set to 0 after first execution).
      const eager =
        'var __esmMin = (fn, res) => { var l = () => (fn && (res = fn(fn = 0)), res); l(); return l; };';

      return { code: code.replace(lazy, eager), map: null };
    },
  };

  return [bundlePlugin, esmInitFixPlugin];
}
