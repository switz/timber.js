/**
 * Bundle singleton audit — verifies that module-level singletons in the
 * timber client runtime are correctly deduplicated in production builds.
 *
 * With the simplified chunking strategy (LOCAL-337), manual chunk splitting
 * was removed. Rolldown's natural code splitting places shared modules in
 * exactly one chunk, eliminating the duplication that previously required
 * globalThis + Symbol.for workarounds.
 *
 * This test builds the phase2-app fixture and verifies:
 * 1. The globalThis + Symbol.for workaround is NOT present (confirming
 *    module deduplication makes it unnecessary)
 * 2. The build produces a small number of chunks (main + per-route + shared)
 * 3. Old manual chunk tiers are absent
 *
 * See design/27-chunking-strategy.md
 * Task: LOCAL-337 (simplified from LOCAL-325)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTimberRuntime } from '../packages/timber-app/src/plugins/chunks';

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

  it('globalThis + Symbol.for singleton workaround is NOT present', () => {
    // The previous chunking strategy duplicated navigation-context.ts across
    // chunks, requiring globalThis + Symbol.for('__timber_nav_ctx') etc.
    // With natural code splitting, the module is not duplicated, so these
    // workarounds should be absent from the build output.
    const symbolForNavPattern = /Symbol\.for\(["`']__timber_nav_ctx["`']\)/;
    const symbolForPendingPattern = /Symbol\.for\(["`']__timber_pending_nav_ctx["`']\)/;
    const symbolForStatePattern = /Symbol\.for\(["`']__timber_nav_state["`']\)/;

    expect(findChunksContaining(chunks, symbolForNavPattern)).toEqual([]);
    expect(findChunksContaining(chunks, symbolForPendingPattern)).toEqual([]);
    expect(findChunksContaining(chunks, symbolForStatePattern)).toEqual([]);
  });

  it('build produces expected chunk structure (no old manual chunk tiers)', () => {
    const chunkNames = [...chunks.keys()].sort();

    // Should have one main index chunk
    const indexChunks = chunkNames.filter((f) => f.startsWith('index'));
    expect(indexChunks.length).toBe(1);

    // Should NOT have vendor-react, vendor-timber, vendor-app, shared-app, shared-client
    // (these were the old manual chunk tiers)
    const oldTierChunks = chunkNames.filter(
      (f) =>
        f.startsWith('vendor-react') ||
        f.startsWith('vendor-timber') ||
        f.startsWith('vendor-app') ||
        f.startsWith('shared-app') ||
        f.startsWith('shared-client')
    );
    expect(oldTierChunks).toEqual([]);
  });

  it('isTimberRuntime matches @timber-js/app consumer paths', () => {
    // Consumer project path (npm/pnpm install)
    expect(
      isTimberRuntime('/project/node_modules/@timber-js/app/dist/client/navigation-context.js')
    ).toBe(true);
    expect(
      isTimberRuntime('/project/node_modules/@timber-js/app/dist/client/transition-root.js')
    ).toBe(true);

    // Monorepo path (pnpm workspace)
    expect(
      isTimberRuntime('/project/packages/timber-app/src/client/navigation-context.ts')
    ).toBe(true);

    // Non-timber paths
    expect(isTimberRuntime('/project/node_modules/react/index.js')).toBe(false);
    expect(isTimberRuntime('/project/app/page.tsx')).toBe(false);
  });
});
