/**
 * timber-chunks — Vite sub-plugin for intelligent client chunk splitting.
 *
 * Splits client bundles into cache tiers based on update frequency:
 *
 * Tier 1: vendor-react    — react, react-dom, scheduler (changes rarely)
 * Tier 2: vendor-timber   — timber runtime, RSC runtime (changes per framework update)
 * Tier 3: vendor-app      — user node_modules (changes on dependency updates)
 * Tier 4: shared-app      — small shared app utilities/components (< 5KB source)
 * Tier 5: [route]-*       — per-route page/layout chunks (default Rollup splitting)
 *
 * The shared-app tier prevents tiny utility modules (constants, helpers,
 * small UI components) from becoming individual chunks when shared across
 * routes. Without this, Rolldown creates per-module chunks for any code
 * shared between two or more entry points, producing many sub-1KB chunks.
 *
 * Server environments (RSC, SSR) are left to Vite's default chunking since
 * Cloudflare Workers load all code from a single deployment bundle with no
 * benefit from cache-tier separation.
 *
 * Design docs: 27-chunking-strategy.md
 */

import { statSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Source file size threshold for the shared-app chunk.
 * Modules under this size that aren't route files get merged into shared-app
 * instead of getting their own tiny chunks.
 */
const SMALL_MODULE_THRESHOLD = 5 * 1024; // 5KB

/**
 * Route convention file basenames (without extension).
 * These files define route segments and must stay in per-route chunks
 * to preserve route-based code splitting.
 */
const ROUTE_FILE_BASENAMES = new Set([
  'page',
  'layout',
  'loading',
  'error',
  'not-found',
  'template',
  'access',
  'middleware',
  'default',
  'route',
]);

/**
 * Cache for source file sizes to avoid repeated statSync calls.
 * Populated lazily during the build.
 */
const sizeCache = new Map<string, number>();

/**
 * Get the source file size, with caching.
 * Returns Infinity for virtual modules or files that can't be stat'd.
 */
function getSourceSize(id: string): number {
  const cached = sizeCache.get(id);
  if (cached !== undefined) return cached;

  try {
    const size = statSync(id).size;
    sizeCache.set(id, size);
    return size;
  } catch {
    sizeCache.set(id, Infinity);
    return Infinity;
  }
}

/**
 * Extract the basename without extension from a module ID.
 * e.g. '/project/app/dashboard/page.tsx' → 'page'
 */
function getBasename(id: string): string {
  const lastSlash = id.lastIndexOf('/');
  const filename = lastSlash >= 0 ? id.substring(lastSlash + 1) : id;
  const dotIndex = filename.indexOf('.');
  return dotIndex >= 0 ? filename.substring(0, dotIndex) : filename;
}

/**
 * Check if a module is a React ecosystem package (tier 1).
 */
function isReactVendor(id: string): boolean {
  return (
    id.includes('node_modules/react-dom') ||
    id.includes('node_modules/react/') ||
    id.includes('node_modules/scheduler')
  );
}

/**
 * Check if a module is part of the timber framework runtime (tier 2).
 *
 * Matches both monorepo paths (packages/timber-app/...) and consumer
 * project paths (node_modules/@timber-js/app/...) so the chunk
 * assignment is consistent regardless of how timber is installed.
 */
function isTimberRuntime(id: string): boolean {
  return (
    id.includes('/timber-app/') ||
    id.includes('/@timber-js/app/') ||
    id.includes('react-server-dom') ||
    id.includes('@vitejs/plugin-rsc')
  );
}

/**
 * Check if a module is a user-installed node_modules dependency (tier 3).
 * Excludes React ecosystem and timber runtime packages which have their own tiers.
 */
function isUserVendor(id: string): boolean {
  return id.includes('node_modules/') && !isReactVendor(id) && !isTimberRuntime(id);
}

/**
 * Check if a module is a route convention file that should stay per-route.
 */
function isRouteFile(id: string): boolean {
  return ROUTE_FILE_BASENAMES.has(getBasename(id));
}

/**
 * Categorize a module ID into a cache tier chunk name.
 *
 * Returns a chunk name for vendor modules and small shared app code,
 * or undefined to let Rollup's default splitting handle route code.
 */
export function assignChunk(id: string): string | undefined {
  // Tier 1: React ecosystem — changes on version bumps only
  if (isReactVendor(id)) {
    return 'vendor-react';
  }

  // Tier 2: timber framework runtime — changes on framework updates
  if (isTimberRuntime(id)) {
    return 'vendor-timber';
  }

  // Tier 3: User vendor libraries — changes on dependency updates
  if (isUserVendor(id)) {
    return 'vendor-app';
  }

  // Tier 4: Small shared app modules — prevents tiny per-module chunks
  // Skip route files (page, layout, etc.) to preserve route-based splitting.
  // Skip virtual modules (contain \0 or don't start with /) as they have no
  // meaningful source size.
  if (!id.includes('\0') && id.startsWith('/') && !isRouteFile(id)) {
    const size = getSourceSize(id);
    if (size < SMALL_MODULE_THRESHOLD) {
      return 'shared-app';
    }
  }

  // Tier 5: Rollup's default splitting (per-route page/layout chunks, large shared modules)
}

/**
 * Group timber's internal 'use client' modules into the vendor-timber chunk.
 *
 * The RSC plugin creates separate entry points for each 'use client' module,
 * which manualChunks can't merge. This function is passed as the RSC plugin's
 * `clientChunks` callback to group timber internals into a single chunk.
 *
 * User client components that are small (< 5KB) are grouped into shared-client
 * to prevent thin facade wrappers from becoming individual chunks. This handles
 * the RSC client reference facade problem where each 'use client' module gets
 * a ~100-300 byte re-export wrapper chunk.
 */
export function assignClientChunk(meta: {
  id: string;
  normalizedId: string;
  serverChunk: string;
}): string | undefined {
  // Timber framework client modules → vendor-timber
  // Match both monorepo paths (/timber-app/) and consumer paths (/@timber-js/app/)
  if (meta.id.includes('/timber-app/') || meta.id.includes('/@timber-js/app/'))
    return 'vendor-timber';

  // Small user client components → shared-client (prevents facade micro-chunks)
  if (!meta.id.includes('\0') && meta.id.startsWith('/')) {
    const size = getSourceSize(meta.id);
    if (size < SMALL_MODULE_THRESHOLD) {
      return 'shared-client';
    }
  }

  // Large user/third-party client components → default per-route splitting
}

/**
 * Create the timber-chunks Vite plugin.
 *
 * Uses Vite's per-environment config to apply manualChunks only to
 * the client build. The config hook runs before environments are
 * created, so we use `environments.client` to target the client.
 */
export function timberChunks(): Plugin {
  return {
    name: 'timber-chunks',

    config() {
      return {
        environments: {
          client: {
            build: {
              rollupOptions: {
                output: {
                  manualChunks: assignChunk,
                },
              },
            },
          },
        },
      };
    },
  };
}
