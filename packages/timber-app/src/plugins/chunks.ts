/**
 * timber-chunks — Vite sub-plugin for intelligent client chunk splitting.
 *
 * Splits client bundles into cache tiers based on update frequency:
 *
 * Tier 1: vendor-react  — react, react-dom, scheduler (changes rarely)
 * Tier 2: vendor-timber — timber runtime, RSC runtime (changes per framework update)
 * Tier 3: [route]-*     — per-route app code (changes per deploy, handled by Vite defaults)
 *
 * Server environments (RSC, SSR) are left to Vite's default chunking since
 * Cloudflare Workers load all code from a single deployment bundle with no
 * benefit from cache-tier separation.
 *
 * Design docs: 27-chunking-strategy.md
 */

import type { Plugin } from 'vite';

/**
 * Categorize a module ID into a cache tier chunk name.
 *
 * Returns a chunk name for vendor modules, or undefined to let
 * Rollup's default splitting handle app/route code.
 */
function assignChunk(id: string): string | undefined {
  // Tier 1: React ecosystem — changes on version bumps only
  if (
    id.includes('node_modules/react-dom') ||
    id.includes('node_modules/react/') ||
    id.includes('node_modules/scheduler')
  ) {
    return 'vendor-react';
  }

  // Tier 2: timber framework runtime — changes on framework updates
  if (
    id.includes('/timber-app/') ||
    id.includes('react-server-dom') ||
    id.includes('@vitejs/plugin-rsc')
  ) {
    return 'vendor-timber';
  }

  // Everything else: Rollup's default splitting (per-route chunks)
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
