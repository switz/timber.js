/**
 * Client bundle audit — verifies that server-only code doesn't leak into
 * the browser entry point's dependency tree.
 *
 * This test statically traces imports from browser-entry.ts and verifies
 * that no server-only modules are reachable. It catches regressions where
 * a new import accidentally pulls server code into the client bundle.
 *
 * Task: TIM-283
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = resolve(__dirname, '../packages/timber-app/src/client');
const SRC_DIR = resolve(__dirname, '../packages/timber-app/src');

/**
 * Extract relative import paths from a TypeScript file.
 * Only matches local imports (starting with . or ..), not package imports.
 * Skips `import type` statements (they have no runtime cost).
 */
function extractRuntimeImports(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const imports: string[] = [];

  // Match: import { ... } from '...' or import ... from '...'
  // Skip: import type { ... } from '...'
  const importRegex = /import\s+(?!type\s).*?\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const specifier = match[1];
    if (specifier.startsWith('.')) {
      imports.push(specifier);
    }
  }

  // Also match re-exports: export { ... } from '...'
  // Skip: export type { ... } from '...'
  const reExportRegex = /export\s+(?!type\s)\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const specifier = match[1];
    if (specifier.startsWith('.')) {
      imports.push(specifier);
    }
  }

  return imports;
}

/**
 * Resolve a relative import from a source file to an absolute path.
 */
function resolveImport(fromFile: string, specifier: string): string {
  const dir = dirname(fromFile);
  let resolved = resolve(dir, specifier);

  // Strip .js extension (TypeScript source uses .ts)
  if (resolved.endsWith('.js')) {
    resolved = resolved.slice(0, -3) + '.ts';
  }
  // Try .ts and .tsx extensions
  for (const ext of ['.ts', '.tsx']) {
    const withExt = resolved.endsWith(ext) ? resolved : resolved + ext;
    try {
      readFileSync(withExt);
      return withExt;
    } catch {
      // continue
    }
  }
  return resolved;
}

/**
 * Recursively collect all local files reachable from a given entry file.
 * Only follows relative imports within the timber-app/src directory.
 */
function traceImports(entryFile: string, visited = new Set<string>()): Set<string> {
  if (visited.has(entryFile)) return visited;
  visited.add(entryFile);

  let imports: string[];
  try {
    imports = extractRuntimeImports(entryFile);
  } catch {
    return visited;
  }

  for (const specifier of imports) {
    const resolved = resolveImport(entryFile, specifier);
    // Only trace within timber-app/src
    if (resolved.startsWith(SRC_DIR)) {
      traceImports(resolved, visited);
    }
  }

  return visited;
}

describe('client bundle audit', () => {
  const browserEntry = resolve(CLIENT_DIR, 'browser-entry.ts');
  const reachableFiles = traceImports(browserEntry);

  // Convert to relative paths for readable assertions
  const relativePaths = [...reachableFiles].map((f) =>
    f.startsWith(SRC_DIR) ? f.slice(SRC_DIR.length + 1) : f
  );

  it('browser entry does not import from server/', () => {
    const serverImports = relativePaths.filter((p) => p.startsWith('server/'));
    expect(serverImports).toEqual([]);
  });

  it('browser entry does not import from plugins/', () => {
    const pluginImports = relativePaths.filter((p) => p.startsWith('plugins/'));
    expect(pluginImports).toEqual([]);
  });

  it('browser entry does not import from routing/', () => {
    const routingImports = relativePaths.filter((p) => p.startsWith('routing/'));
    expect(routingImports).toEqual([]);
  });

  it('browser entry does not import from cache/', () => {
    const cacheImports = relativePaths.filter((p) => p.startsWith('cache/'));
    expect(cacheImports).toEqual([]);
  });

  it('browser entry does not import from adapters/', () => {
    const adapterImports = relativePaths.filter((p) => p.startsWith('adapters/'));
    expect(adapterImports).toEqual([]);
  });

  it('only imports from client/ and search-params/', () => {
    const allowedPrefixes = ['client/', 'search-params/'];
    const unexpected = relativePaths.filter(
      (p) => !allowedPrefixes.some((prefix) => p.startsWith(prefix))
    );
    expect(unexpected).toEqual([]);
  });

  it('navigation-client shim does not import from server/', () => {
    const navClient = resolve(SRC_DIR, 'shims/navigation-client.ts');
    const navImports = traceImports(navClient);
    const navRelative = [...navImports].map((f) =>
      f.startsWith(SRC_DIR) ? f.slice(SRC_DIR.length + 1) : f
    );
    const serverImports = navRelative.filter((p) => p.startsWith('server/'));
    expect(serverImports).toEqual([]);
  });

  it('navigation (full) shim imports from server/primitives', () => {
    const navFull = resolve(SRC_DIR, 'shims/navigation.ts');
    const navImports = traceImports(navFull);
    const navRelative = [...navImports].map((f) =>
      f.startsWith(SRC_DIR) ? f.slice(SRC_DIR.length + 1) : f
    );
    const serverImports = navRelative.filter((p) => p.startsWith('server/'));
    // The full shim SHOULD import from server — that's expected for RSC/SSR
    expect(serverImports.length).toBeGreaterThan(0);
  });
});
