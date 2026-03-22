/**
 * timber-chunks — Vite sub-plugin for client chunk configuration.
 *
 * Previously implemented a 5-tier cache strategy (vendor-react, vendor-timber,
 * vendor-app, shared-app, shared-client) via manualChunks. This was removed
 * in LOCAL-337 because the cache-tier separation added HTTP requests,
 * complicated the architecture, and caused module duplication across chunks
 * that required globalThis + Symbol.for workarounds.
 *
 * Current strategy: let Rolldown handle natural code splitting.
 * Output is typically:
 *   - 1 main bundle (React + timber runtime + shared app code + user vendors)
 *   - Per-route chunks (page/layout components, only when route-specific)
 *   - rolldown-runtime (Rolldown's own output, unavoidable)
 *
 * Design docs: 27-chunking-strategy.md
 */

import type { Plugin } from 'vite';

/**
 * Check if a module is part of the timber framework runtime.
 *
 * Matches both monorepo paths (packages/timber-app/...) and consumer
 * project paths (node_modules/@timber-js/app/...) so identification
 * is consistent regardless of how timber is installed.
 *
 * Exported for use in tests (singleton-audit, etc.).
 */
export function isTimberRuntime(id: string): boolean {
  return (
    id.includes('/timber-app/') ||
    id.includes('/@timber-js/app/') ||
    id.includes('react-server-dom') ||
    id.includes('@vitejs/plugin-rsc')
  );
}

/**
 * Create the timber-chunks Vite plugin.
 *
 * Currently a no-op — Rolldown's default splitting produces the desired
 * output (one main bundle + per-route chunks). The plugin is retained as
 * a hook point for future chunking adjustments if needed.
 */
export function timberChunks(): Plugin {
  return {
    name: 'timber-chunks',
  };
}
