/**
 * timber-shims — Vite sub-plugin for next/* → timber shim resolution.
 *
 * Intercepts imports of next/* modules and redirects them to timber.js
 * shim implementations. This enables Next.js-compatible libraries
 * (nuqs, next-intl, etc.) to work unmodified.
 *
 * NOTE: This plugin does NOT resolve @timber-js/app/* subpath imports.
 * Those are handled by Vite's native package.json `exports` resolution,
 * which maps them to dist/ files. This ensures a single module instance
 * for shared modules like request-context (ALS singleton).
 *
 * Design doc: 18-build-system.md §"Shim Map"
 */

import type { Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginContext } from '#/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Detect whether we're running from source (src/plugins/) or dist (dist/).
// From src/plugins/: go up 2 levels to package root.
// From dist/: go up 1 level to package root.
// When Rollup bundles into dist/index.js, __dirname is dist/, not src/plugins/.
const PKG_ROOT = __dirname.endsWith('plugins')
  ? resolve(__dirname, '..', '..')
  : resolve(__dirname, '..');
const SHIMS_DIR = resolve(PKG_ROOT, 'src', 'shims');

/**
 * Virtual module IDs for server-only and client-only poison pills.
 *
 * These packages cause build errors when imported in the wrong environment:
 * - `server-only` errors when imported in a client component
 * - `client-only` errors when imported in a server component
 */
const SERVER_ONLY_VIRTUAL = '\0timber:server-only';
const CLIENT_ONLY_VIRTUAL = '\0timber:client-only';

/**
 * Map from next/* import specifiers to shim file paths.
 *
 * The shim map is a separate data structure (not embedded in the plugin)
 * per the task's approach constraints.
 */
const SHIM_MAP: Record<string, string> = {
  'next/link': resolve(SHIMS_DIR, 'link.ts'),
  'next/image': resolve(SHIMS_DIR, 'image.ts'),
  'next/navigation': resolve(SHIMS_DIR, 'navigation.ts'),
  'next/headers': resolve(SHIMS_DIR, 'headers.ts'),
  // next/font/* redirects to the timber-fonts virtual modules.
  // The fonts plugin's load hook serves the actual module code.
  'next/font/google': '\0@timber/fonts/google',
  'next/font/local': '\0@timber/fonts/local',
};

/**
 * Client-only shim overrides for the browser environment.
 *
 * next/navigation in the client environment resolves to navigation-client.ts
 * which only re-exports client hooks — not server functions like redirect()
 * and deny(). This prevents server/primitives.ts from being pulled into the
 * browser bundle via tree-shaking-resistant imports.
 */
const CLIENT_SHIM_OVERRIDES: Record<string, string> = {
  'next/navigation': resolve(SHIMS_DIR, 'navigation-client.ts'),
};

/**
 * Strip .js extension from an import specifier.
 *
 * Libraries like nuqs import `next/navigation.js` with an explicit
 * extension. We strip it before matching against the shim map.
 */
function stripJsExtension(id: string): string {
  return id.endsWith('.js') ? id.slice(0, -3) : id;
}

/**
 * Create the timber-shims Vite plugin.
 *
 * Hooks: resolveId, load
 */
export function timberShims(_ctx: PluginContext): Plugin {
  return {
    name: 'timber-shims',
    // Must run before Vite's built-in resolution so that server-only/client-only
    // poison pills are intercepted even when imported from node_modules deps
    // (e.g. bright, next-intl). Without this, the dep optimizer resolves to the
    // real CJS package which throws at runtime in the SSR environment.
    enforce: 'pre',

    /**
     * Resolve next/* imports to shim files.
     *
     * Resolution order:
     * 1. Check server-only / client-only poison pill packages
     * 2. Strip .js extension from the import specifier
     * 3. Check next/* shim map
     * 4. Return null (pass through) for everything else
     *
     * @timber-js/app/server is resolved to src/ so it shares the same module
     * instance as framework internals (which import via #/). This ensures
     * a single requestContextAls and _getRscFallback variable.
     *
     * @timber-js/app/client is NOT mapped here — it resolves to dist/ via
     * package.json exports, where 'use client' is preserved on the entry.
     */
    resolveId(id: string) {
      // Poison pill packages — resolve to virtual modules handled by load()
      if (id === 'server-only') return SERVER_ONLY_VIRTUAL;
      if (id === 'client-only') return CLIENT_ONLY_VIRTUAL;

      const cleanId = stripJsExtension(id);

      // Check next/* shim map.
      // In the client (browser) environment, use client-only shim overrides
      // to avoid pulling server code (primitives.ts) into the browser bundle.
      if (cleanId in SHIM_MAP) {
        const envName = (this as unknown as { environment?: { name?: string } }).environment?.name;
        if (envName === 'client' && cleanId in CLIENT_SHIM_OVERRIDES) {
          return CLIENT_SHIM_OVERRIDES[cleanId];
        }
        return SHIM_MAP[cleanId];
      }

      // @timber-js/app/server → src/ in server environments so user code
      // shares the same module instance as framework internals (single ALS).
      // In the client environment, return a virtual empty module — server
      // code must never be bundled into the browser.
      if (cleanId === '@timber-js/app/server') {
        const envName = (this as unknown as { environment?: { name?: string } }).environment?.name;
        if (envName === 'client') {
          return '\0timber:server-empty';
        }
        return resolve(PKG_ROOT, 'src', 'server', 'index.ts');
      }

      return null;
    },

    /**
     * Serve virtual modules for server-only / client-only poison pills.
     *
     * In the correct environment, the module is a no-op (empty export).
     * In the wrong environment, it throws a build-time error message that
     * clearly identifies the boundary violation.
     */
    load(id: string) {
      const envName = (this as unknown as { environment?: { name?: string } }).environment?.name;
      const isClient = envName === 'client';

      if (id === SERVER_ONLY_VIRTUAL) {
        if (isClient) {
          return `throw new Error(
  "This module cannot be imported from a Client Component module. " +
  "It should only be used from a Server Component."
);`;
        }
        // No-op in server environments (rsc, ssr)
        return 'export {};';
      }

      if (id === CLIENT_ONLY_VIRTUAL) {
        if (!isClient) {
          return `throw new Error(
  "This module cannot be imported from a Server Component module. " +
  "It should only be used from a Client Component."
);`;
        }
        // No-op in client environment
        return 'export {};';
      }

      // Error module for @timber-js/app/server in client environment.
      // Server modules must never be bundled into the browser — if this
      // module is reached, there is a broken import chain that needs fixing.
      if (id === '\0timber:server-empty') {
        // Export named stubs instead of throwing at evaluation time.
        // Throwing at eval breaks the module system — the browser can't
        // resolve named imports like `import { notFound } from '...'`.
        // Instead, each stub throws at call time with a clear message.
        return `
const msg = "[timber] @timber-js/app/server was imported from client code. " +
  "Server modules (headers, cookies, redirect, deny, etc.) cannot be used in client components. " +
  "If you need these APIs, move the import to a server component or middleware.";
function stub() { throw new Error(msg); }
export const headers = stub;
export const cookies = stub;
export const searchParams = stub;
export const deny = stub;
export const notFound = stub;
export const redirect = stub;
export const permanentRedirect = stub;
export const redirectExternal = stub;
export const waitUntil = stub;
export const RenderError = stub;
export const RedirectType = {};
export const DenySignal = stub;
export const RedirectSignal = stub;
export const createPipeline = stub;
export const revalidatePath = stub;
export const revalidateTag = stub;
export const createActionClient = stub;
export const ActionError = stub;
export const validated = stub;
export const getFormFlash = stub;
export const parseFormData = stub;
export const coerce = stub;
`;
      }
    },
  };
}
