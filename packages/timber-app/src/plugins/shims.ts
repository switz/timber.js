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
import type { PluginContext } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIMS_DIR = resolve(__dirname, '..', 'shims');

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
 * Hooks: resolveId
 */
export function timberShims(_ctx: PluginContext): Plugin {
  return {
    name: 'timber-shims',

    /**
     * Resolve next/* and @timber/app/* imports to shim/source files.
     *
     * Resolution order:
     * 1. Strip .js extension from the import specifier
     * 2. Check next/* shim map
     * 3. Check @timber/app/* subpath map
     * 4. Return null (pass through) for unrecognized imports
     */
    resolveId(id: string) {
      const cleanId = stripJsExtension(id);

      // Check next/* shim map
      if (cleanId in SHIM_MAP) {
        return SHIM_MAP[cleanId];
      }

      // Check @timber/app/* subpath map
      if (cleanId in TIMBER_SUBPATH_MAP) {
        return TIMBER_SUBPATH_MAP[cleanId];
      }

      return null;
    },
  };
}
