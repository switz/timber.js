import type { Plugin } from 'vite';

/**
 * Redirect React's CJS development bundles to production bundles.
 *
 * React packages use a runtime `process.env.NODE_ENV` check in their CJS
 * entry points to conditionally require either `*.development.js` or
 * `*.production.js`. Rollup's CJS plugin resolves both branches statically
 * before the `define` replacement can eliminate the dead branch, causing
 * development React code to be included in production builds.
 *
 * This plugin intercepts `resolveId` and rewrites any `*.development.js`
 * import under `react/cjs/`, `react-dom/cjs/`, or `scheduler/cjs/` to
 * its `*.production.js` counterpart.
 *
 * Only active in production builds. Has no effect in dev mode.
 */
export function timberReactProd(): Plugin {
  let isProd = false;

  return {
    name: 'timber-react-prod',
    enforce: 'pre',
    configResolved(config) {
      isProd = config.command === 'build' && config.mode === 'production';
    },
    resolveId: {
      order: 'pre',
      async handler(source, importer, options) {
        if (!isProd) return;

        // Match: react/cjs/*.development.js, react-dom/cjs/*.development.js, scheduler/cjs/*.development.js
        if (!source.includes('.development.')) return;

        const resolved = await this.resolve(source, importer, {
          ...options,
          skipSelf: true,
        });
        if (!resolved) return;

        // Only rewrite paths inside react/react-dom/scheduler/react-server-dom CJS directories
        if (
          !resolved.id.includes('/react/cjs/') &&
          !resolved.id.includes('/react-dom/cjs/') &&
          !resolved.id.includes('/scheduler/cjs/') &&
          !resolved.id.includes('/react-server-dom/cjs/')
        ) {
          return;
        }

        const prodId = resolved.id.replace('.development.', '.production.');
        return { ...resolved, id: prodId };
      },
    },
  };
}
