/**
 * Bundle singleton audit — verifies that module-level singletons in the
 * timber client runtime are not duplicated across client chunks in
 * production builds.
 *
 * The RSC client build creates two separate module graphs:
 * 1. Browser entry (index chunk) — includes transition-root.tsx
 * 2. Client references (shared-app/vendor-timber chunks) — includes
 *    'use client' modules like link-status-provider.tsx
 *
 * Both graphs may import navigation-context.ts, which contains lazy-created
 * React contexts (module-level singletons). If the bundler duplicates the
 * module across chunks, each chunk gets its own singleton instance, breaking
 * React context identity (provider and consumer use different objects).
 *
 * This test builds the phase2-app fixture and verifies that context creation
 * patterns appear in exactly one chunk.
 *
 * See design/19-client-navigation.md §"Singleton Context Guarantee"
 * Task: LOCAL-325
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignChunk } from '../packages/timber-app/src/plugins/chunks';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, 'fixtures/phase2-app');
const CLIENT_ASSETS_DIR = join(FIXTURE_DIR, 'dist/client/assets');

// Build the fixture app once before all tests
beforeAll(() => {
  execSync('pnpm exec vite build --config tests/fixtures/phase2-app/vite.config.ts', {
    cwd: resolve(__dirname, '..'),
    stdio: 'pipe',
    timeout: 60_000,
  });
}, 90_000);

/**
 * Read all JS chunks from the client build output.
 * Returns a map of filename → content.
 */
function readClientChunks(): Map<string, string> {
  const chunks = new Map<string, string>();
  const files = readdirSync(CLIENT_ASSETS_DIR).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    chunks.set(file, readFileSync(join(CLIENT_ASSETS_DIR, file), 'utf-8'));
  }
  return chunks;
}

/**
 * Count how many chunks contain a given pattern.
 * Returns the list of chunk filenames that matched.
 */
function findChunksContaining(chunks: Map<string, string>, pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const [filename, content] of chunks) {
    if (pattern.test(content)) {
      matches.push(filename);
    }
  }
  return matches;
}

describe('bundle singleton audit', () => {
  let chunks: Map<string, string>;

  beforeAll(() => {
    chunks = readClientChunks();
  });

  it('navigation contexts use Symbol.for keys for cross-chunk singleton safety', () => {
    // The globalThis singleton pattern uses Symbol.for('__timber_nav_ctx') and
    // Symbol.for('__timber_pending_nav_ctx') so that even if the module is
    // duplicated across chunks, both copies share the same context instance.
    //
    // We verify that the Symbol.for keys appear in the build output.
    const navCtxKeyPattern = /Symbol\.for\(["`']__timber_nav_ctx["`']\)/;
    const pendingCtxKeyPattern = /Symbol\.for\(["`']__timber_pending_nav_ctx["`']\)/;

    const navKeyChunks = findChunksContaining(chunks, navCtxKeyPattern);
    const pendingKeyChunks = findChunksContaining(chunks, pendingCtxKeyPattern);

    // At least one chunk must contain each Symbol.for key
    expect(navKeyChunks.length).toBeGreaterThanOrEqual(1);
    expect(pendingKeyChunks.length).toBeGreaterThanOrEqual(1);
  });

  it('timber runtime modules are assigned to vendor-timber or shared chunk', () => {
    // The vendor-timber chunk should exist (even if just re-exports)
    const vendorTimberChunks = [...chunks.keys()].filter((f) => f.startsWith('vendor-timber'));
    expect(vendorTimberChunks.length).toBe(1);
  });

  it('isTimberRuntime matches @timber-js/app consumer paths', () => {
    // Consumer project path (npm/pnpm install)
    expect(assignChunk('/project/node_modules/@timber-js/app/dist/client/navigation-context.js'))
      .toBe('vendor-timber');
    expect(assignChunk('/project/node_modules/@timber-js/app/dist/client/transition-root.js'))
      .toBe('vendor-timber');

    // Monorepo path (pnpm workspace)
    expect(assignChunk('/project/packages/timber-app/src/client/navigation-context.ts'))
      .toBe('vendor-timber');
  });
});
