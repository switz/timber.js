/**
 * timber-shims — Vite sub-plugin for next/* → timber shim resolution.
 *
 * Intercepts imports of next/* modules and redirects them to timber.js
 * shim implementations. This enables Next.js-compatible libraries
 * (nuqs, next-intl, etc.) to work unmodified.
 *
 * Design doc: 18-build-system.md §"Shim Map"
 */

import type { Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginContext } from '#/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIMS_DIR = resolve(__dirname, '..', 'shims');

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
 * Map from @timber/app/* subpath imports to real source files.
 *
 * These resolve subpath imports like `@timber/app/server` to the
 * real entry files in the package source.
 */
const TIMBER_SUBPATH_MAP: Record<string, string> = {
  '@timber/app/server': resolve(__dirname, '..', 'server', 'index.ts'),
  '@timber/app/client': resolve(__dirname, '..', 'client', 'index.ts'),
  '@timber/app/cache': resolve(__dirname, '..', 'cache', 'index.ts'),
  '@timber/app/search-params': resolve(__dirname, '..', 'search-params', 'index.ts'),
  '@timber/app/routing': resolve(__dirname, '..', 'routing', 'index.ts'),
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
     * Resolve next/* and @timber/app/* imports to shim/source files.
     *
     * Resolution order:
     * 1. Check server-only / client-only poison pill packages
     * 2. Strip .js extension from the import specifier
     * 3. Check next/* shim map
     * 4. Check @timber/app/* subpath map
     * 5. Return null (pass through) for unrecognized imports
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

      // Check @timber/app/* subpath map
      if (cleanId in TIMBER_SUBPATH_MAP) {
        return TIMBER_SUBPATH_MAP[cleanId];
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

      return null;
    },
  };
}
