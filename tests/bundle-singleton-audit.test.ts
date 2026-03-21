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

  it('navigation context lazy initializer appears in exactly one chunk', () => {
    // The getOrCreateContext pattern: variable === undefined && createContext(null)
    // In minified output this becomes something like: m===void 0&&...createContext(null)
    // We look for the pattern of a lazy context creation with createContext(null)
    // followed by the guard check (void 0 or undefined)
    const lazyContextPattern = /void 0&&typeof \w+\.createContext/;
    const matchingChunks = findChunksContaining(chunks, lazyContextPattern);

    expect(matchingChunks.length).toBe(1);
    // It should be in a shared chunk (shared-app or vendor-timber), not in the index chunk
    const indexChunks = matchingChunks.filter((f) => f.startsWith('index-'));
    expect(indexChunks).toEqual([]);
  });

  it('PendingNavigationContext is not duplicated across chunks', () => {
    // Count how many chunks have their own createContext(null) calls.
    // vendor-react has React's createContext definition (not a call).
    // We're looking for actual createContext(null) invocations.
    const contextCallPattern = /\.createContext\(null\)/g;

    const chunksWithContextCalls: Array<{ file: string; count: number }> = [];
    for (const [filename, content] of chunks) {
      // Skip vendor-react which contains React's own createContext definition
      if (filename.startsWith('vendor-react')) continue;
      const matches = content.match(contextCallPattern);
      if (matches) {
        chunksWithContextCalls.push({ file: filename, count: matches.length });
      }
    }

    // All createContext(null) calls should be in exactly one chunk
    expect(chunksWithContextCalls.length).toBe(1);
    // That chunk should contain exactly 2 calls:
    // 1. getOrCreateContext (NavigationContext)
    // 2. getOrCreatePendingContext (PendingNavigationContext)
    expect(chunksWithContextCalls[0].count).toBe(2);
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
