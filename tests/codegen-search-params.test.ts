import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generateRouteMap } from '../packages/timber-app/src/routing/codegen.js';
import { scanRoutes } from '@timber-js/app/routing';

const TMP_DIR = join(import.meta.dirname, '.tmp-codegen-sp-test');

function createApp(files: Record<string, string>): string {
  const root = join(TMP_DIR, 'app');
  mkdirSync(root, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(root, filePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('useQueryStates codegen overloads', () => {
  it('emits typed overload for route with search-params.ts', () => {
    const root = createApp({
      'products/page.tsx': '',
      'products/search-params.ts': `
import { createSearchParams } from '@timber-js/app/search-params'
export default createSearchParams({
  page: { parse: (v) => Number(v) || 1, serialize: (v) => String(v) },
})
`,
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree, { appDir: root });

    // Should have a useQueryStates overload for /products
    expect(output).toMatch(/useQueryStates.*'\/products'/);
    // The type should reference the search-params module via import inference
    expect(output).toMatch(/useQueryStates.*SearchParamsDefinition<infer T>/);
  });

  it('emits empty-object overload for route without search-params.ts', () => {
    const root = createApp({
      'about/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree, { appDir: root });

    // Should have a useQueryStates overload for /about returning [{}, SetParams<{}>]
    expect(output).toMatch(/useQueryStates.*'\/about'.*\[\{\}, SetParams<\{\}>\]/);
  });

  it('emits fallback overload for standalone codecs', () => {
    const root = createApp({
      'page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree, { appDir: root });

    // Should have the fallback overload accepting a codec map
    expect(output).toMatch(
      /useQueryStates<T extends Record<string, unknown>>\(codecs.*SearchParamCodec/
    );
  });

  it('does not emit overloads for API routes', () => {
    const root = createApp({
      'api/users/route.ts': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree, { appDir: root });

    // API routes should not get useQueryStates overloads
    expect(output).not.toMatch(/useQueryStates.*'\/api\/users'/);
  });

  it('multiple routes generate ordered overloads', () => {
    const root = createApp({
      'page.tsx': '',
      'products/page.tsx': '',
      'products/search-params.ts': 'export default createSearchParams({})',
      'dashboard/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree, { appDir: root });

    // All page routes should have overloads
    expect(output).toMatch(/useQueryStates.*'\/'/);
    expect(output).toMatch(/useQueryStates.*'\/dashboard'/);
    expect(output).toMatch(/useQueryStates.*'\/products'/);

    // Deterministic order (alphabetical)
    const rootIdx = output.indexOf("useQueryStates<R extends '/'>");
    const dashIdx = output.indexOf("useQueryStates<R extends '/dashboard'>");
    const prodIdx = output.indexOf("useQueryStates<R extends '/products'>");
    expect(rootIdx).toBeLessThan(dashIdx);
    expect(dashIdx).toBeLessThan(prodIdx);
  });

  it('imports SetParams and QueryStatesOptions types', () => {
    const root = createApp({
      'page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree, { appDir: root });

    expect(output).toContain('SetParams');
    expect(output).toContain('QueryStatesOptions');
    expect(output).toContain('SearchParamCodec');
  });

  it('balanced braces in generated output', () => {
    const root = createApp({
      'page.tsx': '',
      'products/[id]/page.tsx': '',
      'products/[id]/search-params.ts': 'export default createSearchParams({})',
      'about/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree, { appDir: root });

    const braceCount = (output.match(/\{/g) || []).length;
    const closeBraceCount = (output.match(/\}/g) || []).length;
    expect(braceCount).toBe(closeBraceCount);
  });
});
