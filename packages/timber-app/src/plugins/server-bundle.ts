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
  // The fix: patch `__esmMin` to eagerly *attempt* each init, but fall
  // back to lazy retry on failure. This handles two failure modes:
  //
  // 1. Forward references (e.g. Zod v4): `init_iso` calls `init_schemas`
  //    which hasn't been defined yet. Eager execution fails, but when the
  //    function is called lazily later, all dependencies are available.
  //
  // 2. Optional peer dep shims (e.g. @emotion/is-prop-valid for
  //    framer-motion): Vite generates shims that throw for missing
  //    optional deps. The throw is deferred to lazy execution where
  //    the consuming package's try/catch handles it.
  //
  // The key: on failure, `fn` is NOT cleared, so the next call retries.
  // On success, `fn` is set to 0 so subsequent calls are no-ops.
  const esmInitFixPlugin: Plugin = {
    name: 'timber-esm-init-fix',
    applyToEnvironment(environment) {
      return environment.name === 'rsc' || environment.name === 'ssr';
    },
    renderChunk(code) {
      const lazy = 'var __esmMin = (fn, res) => () => (fn && (res = fn(fn = 0)), res);';
      if (!code.includes(lazy)) return null;

      // Eager-with-retry: attempt init immediately. On success, mark done
      // (fn = 0). On failure, leave fn intact so the lazy wrapper retries
      // on next call — by then forward dependencies are initialized.
      const eager = [
        'var __esmMin = (fn, res) => {',
        '  var l = () => { if (fn) { var f = fn; try { res = f(); fn = 0; } catch(e) {} } return res; };',
        '  l();',
        '  return l;',
        '};',
      ].join(' ');

      return { code: code.replace(lazy, eager), map: null };
    },
  };

  return [bundlePlugin, esmInitFixPlugin];
}
