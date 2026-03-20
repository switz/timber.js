/**
 * Singleton state audit — verifies that shared mutable state follows the
 * Module Singleton Strategy documented in design/18-build-system.md.
 *
 * This test statically traces imports to enforce:
 * 1. All client-side mutable state lives in client/state.ts
 * 2. All server-side ALS instances live in server/als-registry.ts
 * 3. browser-entry.ts and shim files import shared state via barrels,
 *    not relative paths to state modules
 * 4. No new AsyncLocalStorage instances are created outside als-registry.ts
 *    (except the adapter-specific bindingsAls in cloudflare.ts and the
 *    ssrDataAls in ssr-entry.ts which are in different environments)
 *
 * Task: LOCAL-308
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '../packages/timber-app/src');
const CLIENT_DIR = resolve(SRC_DIR, 'client');
const SERVER_DIR = resolve(SRC_DIR, 'server');

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Recursively collect all .ts/.tsx files under a directory.
 */
function collectFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFiles(full, files);
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Read a file and return its content.
 */
function read(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

/**
 * Get relative path from SRC_DIR for readable test output.
 */
function rel(filePath: string): string {
  return relative(SRC_DIR, filePath);
}

// ─── Test: Client mutable state centralization ────────────────────────────

describe('client singleton state', () => {
  // Files that are ALLOWED to declare module-level `let` variables for
  // mutable state because they ARE the state registry:
  const STATE_REGISTRY = resolve(CLIENT_DIR, 'state.ts');

  it('client/state.ts exists and exports all shared mutable state', () => {
    const content = read(STATE_REGISTRY);
    // Must export the key state variables
    expect(content).toContain('globalRouter');
    expect(content).toContain('ssrDataProvider');
    expect(content).toContain('currentSsrData');
    expect(content).toContain('currentParams');
    expect(content).toContain('cachedSearch');
    expect(content).toContain('unloading');
  });

  it('router-ref.ts delegates to state.ts', () => {
    const content = read(resolve(CLIENT_DIR, 'router-ref.ts'));
    expect(content).toContain("from './state.js'");
    // Should NOT declare its own `let globalRouter`
    expect(content).not.toMatch(/^let globalRouter/m);
  });

  it('ssr-data.ts delegates to state.ts', () => {
    const content = read(resolve(CLIENT_DIR, 'ssr-data.ts'));
    expect(content).toContain("from './state.js'");
    // Should NOT declare its own `let _ssrDataProvider` or `let currentSsrData`
    expect(content).not.toMatch(/^let _ssrDataProvider/m);
    expect(content).not.toMatch(/^let currentSsrData/m);
  });

  it('use-params.ts delegates to state.ts', () => {
    const content = read(resolve(CLIENT_DIR, 'use-params.ts'));
    expect(content).toContain("from './state.js'");
    // Should NOT declare its own `let currentParams`
    expect(content).not.toMatch(/^let currentParams/m);
  });

  it('use-search-params.ts delegates to state.ts', () => {
    const content = read(resolve(CLIENT_DIR, 'use-search-params.ts'));
    expect(content).toContain("from './state.js'");
    // Should NOT declare its own `let cachedSearch` or `let cachedParams`
    expect(content).not.toMatch(/^let cachedSearch/m);
    expect(content).not.toMatch(/^let cachedParams/m);
  });

  it('unload-guard.ts delegates to state.ts', () => {
    const content = read(resolve(CLIENT_DIR, 'unload-guard.ts'));
    expect(content).toContain("from './state.js'");
    // Should NOT declare its own `let unloading`
    expect(content).not.toMatch(/^let unloading/m);
  });
});

// ─── Test: Server ALS centralization ──────────────────────────────────────

describe('server ALS registry', () => {
  const ALS_REGISTRY = resolve(SERVER_DIR, 'als-registry.ts');

  // Files that are ALLOWED to create new AsyncLocalStorage instances
  // because they operate in a different Vite environment:
  const ALS_EXCEPTIONS = new Set([
    'server/als-registry.ts', // the registry itself
    'server/ssr-entry.ts', // SSR environment — different module graph
    'adapters/cloudflare.ts', // platform-specific bindings
  ]);

  it('server/als-registry.ts exists and exports all ALS instances', () => {
    const content = read(ALS_REGISTRY);
    expect(content).toContain('requestContextAls');
    expect(content).toContain('traceAls');
    expect(content).toContain('timingAls');
    expect(content).toContain('revalidationAls');
    expect(content).toContain('formFlashAls');
    expect(content).toContain('earlyHintsSenderAls');
  });

  it('no new AsyncLocalStorage() outside als-registry.ts (in server/)', () => {
    const serverFiles = collectFiles(SERVER_DIR);
    const violations: string[] = [];

    for (const filePath of serverFiles) {
      const relPath = rel(filePath);
      if (ALS_EXCEPTIONS.has(relPath)) continue;

      const content = read(filePath);
      // Match `new AsyncLocalStorage<` or `new AsyncLocalStorage()` but NOT
      // `new AsyncLocalStorageContextManager` (OTEL's context manager in tracing.ts).
      if (/new AsyncLocalStorage[<(]/.test(content)) {
        violations.push(relPath);
      }
    }

    expect(violations).toEqual([]);
  });

  it('request-context.ts imports ALS from als-registry.ts', () => {
    const content = read(resolve(SERVER_DIR, 'request-context.ts'));
    expect(content).toContain("from './als-registry.js'");
    expect(content).not.toMatch(/new AsyncLocalStorage/);
  });

  it('tracing.ts imports ALS from als-registry.ts', () => {
    const content = read(resolve(SERVER_DIR, 'tracing.ts'));
    expect(content).toContain("from './als-registry.js'");
    // tracing.ts still uses `new AsyncLocalStorageContextManager()` for OTEL — that's OK
    // Check that it doesn't create a new ALS for traceAls
    expect(content).not.toMatch(/new AsyncLocalStorage<TraceStore>/);
  });

  it('actions.ts imports ALS from als-registry.ts', () => {
    const content = read(resolve(SERVER_DIR, 'actions.ts'));
    expect(content).toContain("from './als-registry.js'");
    expect(content).not.toMatch(/new AsyncLocalStorage/);
  });

  it('server-timing.ts imports ALS from als-registry.ts', () => {
    const content = read(resolve(SERVER_DIR, 'server-timing.ts'));
    expect(content).toContain("from './als-registry.js'");
    expect(content).not.toMatch(/new AsyncLocalStorage/);
  });

  it('form-flash.ts imports ALS from als-registry.ts', () => {
    const content = read(resolve(SERVER_DIR, 'form-flash.ts'));
    expect(content).toContain("from './als-registry.js'");
    expect(content).not.toMatch(/new AsyncLocalStorage/);
  });

  it('early-hints-sender.ts imports ALS from als-registry.ts', () => {
    const content = read(resolve(SERVER_DIR, 'early-hints-sender.ts'));
    expect(content).toContain("from './als-registry.js'");
    expect(content).not.toMatch(/new AsyncLocalStorage/);
  });
});

// ─── Test: Import path hygiene ────────────────────────────────────────────

describe('import path hygiene', () => {
  it('browser-entry.ts imports shared state from @timber-js/app/client barrel', () => {
    const content = read(resolve(CLIENT_DIR, 'browser-entry.ts'));
    // Must import from the barrel for shared state
    expect(content).toContain("from '@timber-js/app/client'");
    // Must NOT import state.ts directly (would bypass barrel → module duplication)
    expect(content).not.toContain("from './state");
    expect(content).not.toContain("from './router-ref");
    expect(content).not.toContain("from './ssr-data");
    expect(content).not.toContain("from './use-params");
    expect(content).not.toContain("from './use-search-params");
  });

  it('navigation-client.ts shim imports from @timber-js/app/client barrel', () => {
    const navClient = resolve(SRC_DIR, 'shims/navigation-client.ts');
    const content = read(navClient);
    expect(content).toContain("@timber-js/app/client");
  });

  it('no shim file imports state.ts directly', () => {
    const shimsDir = resolve(SRC_DIR, 'shims');
    let shimFiles: string[];
    try {
      shimFiles = collectFiles(shimsDir);
    } catch {
      // shims dir might not exist in some configurations
      return;
    }

    const violations: string[] = [];
    for (const filePath of shimFiles) {
      const content = read(filePath);
      if (content.includes("client/state") || content.includes("./state")) {
        violations.push(rel(filePath));
      }
    }
    expect(violations).toEqual([]);
  });
});
