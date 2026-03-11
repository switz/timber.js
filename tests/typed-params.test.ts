import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generateRouteMap } from '../packages/timber-app/src/routing/codegen.js';
import { scanRoutes } from '@timber/app/routing';
import { useParams, setCurrentParams } from '@timber/app/client';

const TMP_DIR = join(import.meta.dirname, '.tmp-typed-params-test');

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

describe('typed params codegen', () => {
  it('per-route params', () => {
    const root = createApp({
      'page.tsx': '',
      'products/[id]/page.tsx': '',
      'products/[id]/layout.tsx': '',
      'products/[id]/middleware.ts': '',
      'products/[id]/access.ts': '',
      'users/[userId]/posts/[postId]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Root route should have empty params
    expect(output).toMatch(/['"]\/['"]\s*:\s*\{[^}]*params\s*:\s*\{\}/);

    // Single dynamic param
    expect(output).toMatch(
      /['"]\/products\/\[id\]['"]\s*:\s*\{[^}]*params\s*:\s*\{\s*id\s*:\s*string\s*\}/
    );

    // Nested dynamic params accumulate
    expect(output).toContain('userId: string');
    expect(output).toContain('postId: string');
  });

  it('catch-all string array', () => {
    const root = createApp({
      'docs/[...slug]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Catch-all params should be string[]
    expect(output).toMatch(/slug\s*:\s*string\[\]/);
    // Should NOT be string[] | undefined
    expect(output).not.toMatch(/slug\s*:\s*string\[\]\s*\|\s*undefined/);
  });

  it('optional catch-all', () => {
    const root = createApp({
      'docs/[[...slug]]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Optional catch-all should be string[] | undefined
    expect(output).toMatch(/slug\s*:\s*string\[\]\s*\|\s*undefined/);
  });

  it('useParams narrowed', () => {
    const root = createApp({
      'products/[id]/page.tsx': '',
      'docs/[...slug]/page.tsx': '',
      'blog/[[...path]]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Should generate useParams overloads for route-narrowed types
    expect(output).toContain('useParams');

    // Each route should have a useParams overload
    expect(output).toMatch(
      /useParams\(route:\s*'\/products\/\[id\]'\)\s*:\s*\{\s*id\s*:\s*string\s*\}/
    );
    expect(output).toMatch(
      /useParams\(route:\s*'\/docs\/\[\.\.\.slug\]'\)\s*:\s*\{\s*slug\s*:\s*string\[\]\s*\}/
    );
    expect(output).toMatch(
      /useParams\(route:\s*'\/blog\/\[\[\.\.\.path\]\]'\)\s*:\s*\{\s*path\s*:\s*string\[\]\s*\|\s*undefined\s*\}/
    );

    // Should have a generic fallback overload
    expect(output).toMatch(/useParams\(\)\s*:\s*Record<string,\s*string\s*\|\s*string\[\]>/);
  });

  it('params types are consistent between Routes and useParams', () => {
    const root = createApp({
      'shop/[storeId]/items/[itemId]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // The params in Routes interface and useParams overload should match
    expect(output).toContain('storeId: string; itemId: string');

    // useParams overload should reference the same shape
    expect(output).toMatch(
      /useParams\(route:\s*'\/shop\/\[storeId\]\/items\/\[itemId\]'\)\s*:\s*\{\s*storeId\s*:\s*string;\s*itemId\s*:\s*string\s*\}/
    );
  });

  it('static routes produce empty params in useParams', () => {
    const root = createApp({
      'about/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Static route useParams returns empty object — no overload needed
    // since there are no dynamic segments. The generic fallback handles it.
    // But the Routes interface should still have params: {}
    expect(output).toMatch(/['"]\/about['"]\s*:\s*\{[^}]*params\s*:\s*\{\}/);
  });

  it('route groups do not affect params', () => {
    const root = createApp({
      '(auth)/settings/[section]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Route group should not appear in URL path
    expect(output).not.toContain('(auth)');
    // But params should still work
    expect(output).toContain("'/settings/[section]'");
    expect(output).toContain('section: string');
  });

  it('API route params in useParams overloads', () => {
    const root = createApp({
      'api/items/[id]/route.ts': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // API routes should also get useParams overloads
    expect(output).toMatch(
      /useParams\(route:\s*'\/api\/items\/\[id\]'\)\s*:\s*\{\s*id\s*:\s*string\s*\}/
    );
  });
});

describe('useParams generic overload and codegen alignment', () => {
  it('base module exports generic overload using Routes interface', () => {
    // The useParams function should accept a route string argument
    // and return params — runtime behavior is the same regardless
    setCurrentParams({ id: '42' });

    // With route argument (for type narrowing)
    expect(useParams('/products/[id]')).toEqual({ id: '42' });

    // Without route argument (fallback)
    expect(useParams()).toEqual({ id: '42' });
  });

  it('codegen overloads align with base generic for all param types', () => {
    const root = createApp({
      'products/[id]/page.tsx': '',
      'docs/[...slug]/page.tsx': '',
      'help/[[...topic]]/page.tsx': '',
      'orgs/[orgId]/repos/[repoId]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Codegen generates per-route overloads in @timber/app/client
    // These work alongside the base generic overload in use-params.ts

    // Single param
    expect(output).toMatch(
      /useParams\(route:\s*'\/products\/\[id\]'\)\s*:\s*\{\s*id\s*:\s*string\s*\}/
    );

    // Catch-all
    expect(output).toMatch(
      /useParams\(route:\s*'\/docs\/\[\.\.\.slug\]'\)\s*:\s*\{\s*slug\s*:\s*string\[\]\s*\}/
    );

    // Optional catch-all
    expect(output).toMatch(
      /useParams\(route:\s*'\/help\/\[\[\.\.\.topic\]\]'\)\s*:\s*\{\s*topic\s*:\s*string\[\]\s*\|\s*undefined\s*\}/
    );

    // Nested params
    expect(output).toMatch(
      /useParams\(route:\s*'\/orgs\/\[orgId\]\/repos\/\[repoId\]'\)\s*:\s*\{\s*orgId\s*:\s*string;\s*repoId\s*:\s*string\s*\}/
    );

    // Fallback overload
    expect(output).toMatch(/useParams\(\)\s*:\s*Record<string,\s*string\s*\|\s*string\[\]>/);

    // Routes interface also has matching params (consistency check)
    expect(output).toMatch(
      /['"]\/products\/\[id\]['"]\s*:\s*\{[^}]*params\s*:\s*\{\s*id\s*:\s*string\s*\}/
    );
  });
});

describe('useParams runtime', () => {
  it('returns current params set by framework', () => {
    setCurrentParams({ id: '42' });
    const params = useParams();
    expect(params).toEqual({ id: '42' });
  });

  it('returns updated params after navigation', () => {
    setCurrentParams({ id: '1' });
    expect(useParams()).toEqual({ id: '1' });

    setCurrentParams({ id: '2', slug: ['a', 'b'] });
    expect(useParams()).toEqual({ id: '2', slug: ['a', 'b'] });
  });

  it('route argument does not affect runtime value', () => {
    setCurrentParams({ id: '99' });
    // The route argument is purely for TypeScript narrowing
    const params = useParams('/products/[id]');
    expect(params).toEqual({ id: '99' });
  });

  it('returns empty object when no params set', () => {
    setCurrentParams({});
    expect(useParams()).toEqual({});
  });
});
