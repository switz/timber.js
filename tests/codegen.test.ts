import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generateRouteMap } from '../packages/timber-app/src/routing/codegen.js';
import { scanRoutes } from '@timber/app/routing';

const TMP_DIR = join(import.meta.dirname, '.tmp-codegen-test');

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

describe('generateRouteMap', () => {
  it('generates route map', () => {
    const root = createApp({
      'page.tsx': '',
      'dashboard/page.tsx': '',
      'about/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Should contain the Routes type
    expect(output).toContain('interface Routes');
    // Should include all routes with pages
    expect(output).toContain("'/'");
    expect(output).toContain("'/dashboard'");
    expect(output).toContain("'/about'");
  });

  it('params shape', () => {
    const root = createApp({
      'products/[id]/page.tsx': '',
      'users/[userId]/posts/[postId]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Single dynamic param
    expect(output).toContain("'/products/[id]'");
    expect(output).toMatch(/['"]\/products\/\[id\]['"]\s*:\s*\{[^}]*params\s*:\s*\{\s*id\s*:\s*string/);

    // Nested dynamic params
    expect(output).toContain("'/users/[userId]/posts/[postId]'");
    expect(output).toMatch(
      /['"]\/users\/\[userId\]\/posts\/\[postId\]['"]\s*:\s*\{[^}]*params\s*:\s*\{[^}]*userId\s*:\s*string/
    );
    expect(output).toMatch(
      /['"]\/users\/\[userId\]\/posts\/\[postId\]['"]\s*:\s*\{[^}]*params\s*:\s*\{[^}]*postId\s*:\s*string/
    );
  });

  it('search params shape', () => {
    const root = createApp({
      'products/page.tsx': '',
      'products/search-params.ts': `
import { createSearchParams, fromSchema } from '@timber/app/search-params'
export default createSearchParams({
  page: { parse: (v) => Number(v) || 1, serialize: (v) => String(v) },
  q: { parse: (v) => v ?? null, serialize: (v) => v },
})
`,
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree, { appDir: root });

    // Route with search-params.ts should have searchParams marked
    expect(output).toContain("'/products'");
    expect(output).toContain('searchParams');
    // Should reference the search-params module path
    expect(output).toMatch(/search-params/);
  });

  it('dev regeneration', () => {
    const root = createApp({
      'page.tsx': '',
    });

    const tree1 = scanRoutes(root);
    const output1 = generateRouteMap(tree1);
    expect(output1).toContain("'/'");
    expect(output1).not.toContain("'/new-route'");

    // Add a new route
    mkdirSync(join(root, 'new-route'), { recursive: true });
    writeFileSync(join(root, 'new-route/page.tsx'), '');

    // Rescan and regenerate
    const tree2 = scanRoutes(root);
    const output2 = generateRouteMap(tree2);
    expect(output2).toContain("'/new-route'");
  });

  it('catch-all type', () => {
    const root = createApp({
      'docs/[...slug]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Catch-all params should be string[]
    expect(output).toContain("'/docs/[...slug]'");
    expect(output).toMatch(/slug\s*:\s*string\[\]/);
  });

  it('optional catch-all type', () => {
    const root = createApp({
      'docs/[[...slug]]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Optional catch-all should be string[] | undefined
    expect(output).toContain("'/docs/[[...slug]]'");
    expect(output).toMatch(/slug\s*:\s*string\[\]\s*\|\s*undefined/);
  });

  it('route groups do not affect path', () => {
    const root = createApp({
      '(auth)/login/page.tsx': '',
      '(marketing)/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Route groups should not appear in the URL path
    expect(output).toContain("'/login'");
    expect(output).toContain("'/'");
    expect(output).not.toContain("'/(auth)'");
    expect(output).not.toContain("'/(marketing)'");
  });

  it('route.ts API endpoints are included', () => {
    const root = createApp({
      'api/users/route.ts': '',
      'api/products/[id]/route.ts': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    expect(output).toContain("'/api/users'");
    expect(output).toContain("'/api/products/[id]'");
    // API route with dynamic param
    expect(output).toMatch(/['"]\/api\/products\/\[id\]['"]\s*:\s*\{[^}]*params\s*:\s*\{\s*id\s*:\s*string/);
  });

  it('empty params for static routes', () => {
    const root = createApp({
      'about/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Static route should have empty params object
    expect(output).toContain("'/about'");
    expect(output).toMatch(/['"]\/about['"]\s*:\s*\{[^}]*params\s*:\s*\{[^a-z]*\}/);
  });

  it('multiple dynamic segments accumulate params', () => {
    const root = createApp({
      'orgs/[orgId]/teams/[teamId]/members/[memberId]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    const routeKey = "'/orgs/[orgId]/teams/[teamId]/members/[memberId]'";
    expect(output).toContain(routeKey);
    expect(output).toContain('orgId: string');
    expect(output).toContain('teamId: string');
    expect(output).toContain('memberId: string');
  });

  it('generates valid TypeScript', () => {
    const root = createApp({
      'page.tsx': '',
      'products/[id]/page.tsx': '',
      'docs/[...slug]/page.tsx': '',
      '(auth)/login/page.tsx': '',
      'api/users/route.ts': '',
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree);

    // Should be a valid TS declaration file structure
    expect(output).toContain('declare module');
    expect(output).toContain('interface Routes');
    // No syntax errors — basic structural checks
    const braceCount = (output.match(/\{/g) || []).length;
    const closeBraceCount = (output.match(/\}/g) || []).length;
    expect(braceCount).toBe(closeBraceCount);
  });

  it('search-params.ts detection via file system', () => {
    const root = createApp({
      'products/page.tsx': '',
      'products/search-params.ts': 'export default createSearchParams({})',
      'about/page.tsx': '',
      // about has no search-params.ts
    });

    const tree = scanRoutes(root);
    const output = generateRouteMap(tree, { appDir: root });

    // Products route should reference search params
    expect(output).toMatch(/['"]\/products['"]\s*:\s*\{[\s\S]*?searchParams/);
  });
});
