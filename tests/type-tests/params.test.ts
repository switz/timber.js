/**
 * Type-level tests for route params per-route typing.
 *
 * Validates that the codegen produces correct TypeScript types
 * for dynamic segments, catch-all, optional catch-all, and
 * that useParams overloads narrow correctly.
 *
 * These tests verify the generated declaration file structure
 * rather than runtime behavior (covered in typed-params.test.ts).
 *
 * Acceptance criteria: timber-dch.2.6
 *   - Type-level: params typed per-route
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generateRouteMap } from '../../packages/timber-app/src/routing/codegen.js';
import { scanRoutes } from '@timber/app/routing';

const TMP_DIR = join(import.meta.dirname, '.tmp-type-params-test');

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

// ─── Routes interface params typing ──────────────────────────────

describe('Routes interface params typing', () => {
  it('static route has empty params: {}', () => {
    const root = createApp({ 'about/page.tsx': '' });
    const output = generateRouteMap(scanRoutes(root));

    expect(output).toMatch(/['"]\/about['"]\s*:\s*\{[^}]*params\s*:\s*\{\}/);
  });

  it('single dynamic segment has { name: string }', () => {
    const root = createApp({ 'products/[id]/page.tsx': '' });
    const output = generateRouteMap(scanRoutes(root));

    expect(output).toMatch(/params\s*:\s*\{\s*id\s*:\s*string\s*\}/);
  });

  it('catch-all has { slug: string[] }', () => {
    const root = createApp({ 'docs/[...slug]/page.tsx': '' });
    const output = generateRouteMap(scanRoutes(root));

    expect(output).toMatch(/slug\s*:\s*string\[\]/);
    // Must NOT be optional
    expect(output).not.toMatch(/slug\s*:\s*string\[\]\s*\|\s*undefined/);
  });

  it('optional catch-all has { path: string[] | undefined }', () => {
    const root = createApp({ 'docs/[[...path]]/page.tsx': '' });
    const output = generateRouteMap(scanRoutes(root));

    expect(output).toMatch(/path\s*:\s*string\[\]\s*\|\s*undefined/);
  });

  it('nested dynamic segments accumulate params from ancestors', () => {
    const root = createApp({
      'orgs/[orgId]/repos/[repoId]/issues/[issueId]/page.tsx': '',
    });
    const output = generateRouteMap(scanRoutes(root));

    // All three params must appear in a single route entry
    expect(output).toContain('orgId: string');
    expect(output).toContain('repoId: string');
    expect(output).toContain('issueId: string');
  });

  it('route groups do not introduce spurious params', () => {
    const root = createApp({
      '(marketing)/pricing/page.tsx': '',
      '(auth)/login/page.tsx': '',
    });
    const output = generateRouteMap(scanRoutes(root));

    // Groups should not be in URL or params
    expect(output).not.toContain('(marketing)');
    expect(output).not.toContain('(auth)');
    expect(output).toContain("'/pricing'");
    expect(output).toContain("'/login'");
    // Static routes → empty params
    expect(output).toMatch(/['"]\/pricing['"]\s*:\s*\{[^}]*params\s*:\s*\{\}/);
  });

  it('mixed static and dynamic siblings have independent params', () => {
    const root = createApp({
      'products/page.tsx': '',
      'products/[id]/page.tsx': '',
    });
    const output = generateRouteMap(scanRoutes(root));

    // /products → empty params
    expect(output).toMatch(/['"]\/products['"]\s*:\s*\{[^}]*params\s*:\s*\{\}/);
    // /products/[id] → { id: string }
    expect(output).toMatch(
      /['"]\/products\/\[id\]['"]\s*:\s*\{[^}]*params\s*:\s*\{\s*id\s*:\s*string\s*\}/
    );
  });
});

// ─── useParams overloads typing ─────────────────────────────────

describe('useParams overloads typing', () => {
  it('generates overload for each dynamic route', () => {
    const root = createApp({
      'products/[id]/page.tsx': '',
      'users/[userId]/posts/[postId]/page.tsx': '',
    });
    const output = generateRouteMap(scanRoutes(root));

    expect(output).toMatch(
      /useParams\(route:\s*'\/products\/\[id\]'\)\s*:\s*\{\s*id\s*:\s*string\s*\}/
    );
    expect(output).toMatch(/useParams\(route:\s*'\/users\/\[userId\]\/posts\/\[postId\]'\)/);
  });

  it('catch-all useParams returns string[]', () => {
    const root = createApp({ 'blog/[...slug]/page.tsx': '' });
    const output = generateRouteMap(scanRoutes(root));

    expect(output).toMatch(
      /useParams\(route:\s*'\/blog\/\[\.\.\.slug\]'\)\s*:\s*\{\s*slug\s*:\s*string\[\]\s*\}/
    );
  });

  it('optional catch-all useParams returns string[] | undefined', () => {
    const root = createApp({ 'help/[[...topic]]/page.tsx': '' });
    const output = generateRouteMap(scanRoutes(root));

    expect(output).toMatch(
      /useParams\(route:\s*'\/help\/\[\[\.\.\.topic\]\]'\)\s*:\s*\{\s*topic\s*:\s*string\[\]\s*\|\s*undefined\s*\}/
    );
  });

  it('fallback overload returns Record<string, string | string[]>', () => {
    const root = createApp({ 'items/[id]/page.tsx': '' });
    const output = generateRouteMap(scanRoutes(root));

    expect(output).toMatch(/useParams\(\)\s*:\s*Record<string,\s*string\s*\|\s*string\[\]>/);
  });

  it('static-only app does not generate useParams overloads (no dynamic routes)', () => {
    const root = createApp({
      'page.tsx': '',
      'about/page.tsx': '',
      'contact/page.tsx': '',
    });
    const output = generateRouteMap(scanRoutes(root));

    // No dynamic routes → no useParams overloads for specific routes
    // (the generic fallback may or may not appear, depending on impl)
    expect(output).not.toMatch(/useParams\(route:/);
  });

  it('params in Routes and useParams are consistent', () => {
    const root = createApp({
      'teams/[teamId]/members/[memberId]/page.tsx': '',
    });
    const output = generateRouteMap(scanRoutes(root));

    // Both Routes interface and useParams should contain the same param shape
    const paramsShape = 'teamId: string; memberId: string';
    expect(output).toContain(paramsShape);

    // useParams overload should reference the same shape
    expect(output).toMatch(
      /useParams\(route:\s*'\/teams\/\[teamId\]\/members\/\[memberId\]'\)\s*:\s*\{\s*teamId\s*:\s*string;\s*memberId\s*:\s*string\s*\}/
    );
  });
});
