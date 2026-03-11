import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { interpolateParams, resolveHref, buildLinkProps } from '@timber/app/client';
import { createSearchParams } from '@timber/app/search-params';
import { generateRouteMap } from '../packages/timber-app/src/routing/codegen.js';
import { scanRoutes } from '@timber/app/routing';

// ─── interpolateParams ──────────────────────────────────────────

describe('interpolateParams', () => {
  it('interpolates single dynamic segment', () => {
    expect(interpolateParams('/products/[id]', { id: '123' })).toBe('/products/123');
  });

  it('interpolates multiple dynamic segments', () => {
    expect(
      interpolateParams('/users/[userId]/posts/[postId]', {
        userId: 'u1',
        postId: 'p2',
      })
    ).toBe('/users/u1/posts/p2');
  });

  it('interpolates catch-all segments', () => {
    expect(interpolateParams('/blog/[...slug]', { slug: ['2024', '03', 'hello'] })).toBe(
      '/blog/2024/03/hello'
    );
  });

  it('interpolates catch-all with single value', () => {
    expect(interpolateParams('/blog/[...slug]', { slug: 'hello' })).toBe('/blog/hello');
  });

  it('interpolates optional catch-all with values', () => {
    expect(interpolateParams('/docs/[[...path]]', { path: ['api', 'reference'] })).toBe(
      '/docs/api/reference'
    );
  });

  it('optional catch-all with empty array produces clean path', () => {
    expect(interpolateParams('/docs/[[...path]]', { path: [] })).toBe('/docs');
  });

  it('optional catch-all with undefined produces clean path', () => {
    expect(interpolateParams('/docs/[[...path]]', {})).toBe('/docs');
  });

  it('encodes param values', () => {
    expect(interpolateParams('/search/[q]', { q: 'hello world' })).toBe('/search/hello%20world');
  });

  it('throws for missing required param', () => {
    expect(() => interpolateParams('/products/[id]', {})).toThrow('missing required param "id"');
  });

  it('throws for missing catch-all param', () => {
    expect(() => interpolateParams('/blog/[...slug]', {})).toThrow(
      'missing required catch-all param "slug"'
    );
  });

  it('throws for empty catch-all array', () => {
    expect(() => interpolateParams('/blog/[...slug]', { slug: [] })).toThrow(
      'must have at least one segment'
    );
  });

  it('throws for array value in single segment', () => {
    expect(() => interpolateParams('/products/[id]', { id: ['a', 'b'] })).toThrow(
      'expected a string but received an array'
    );
  });

  it('root route with no segments', () => {
    expect(interpolateParams('/', {})).toBe('/');
  });
});

// ─── resolveHref ────────────────────────────────────────────────

describe('resolveHref', () => {
  it('returns plain href when no params or searchParams', () => {
    expect(resolveHref('/about')).toBe('/about');
  });

  it('interpolates params into pattern', () => {
    expect(resolveHref('/products/[id]', { id: '42' })).toBe('/products/42');
  });

  it('appends searchParams via definition', () => {
    const def = createSearchParams({
      page: {
        parse: (v) => (v ? Number(v) : 1),
        serialize: (v) => String(v),
      },
      q: {
        parse: (v: string | string[] | undefined): string | null =>
          typeof v === 'string' ? v : null,
        serialize: (v: string | null): string | null => v,
      },
    });

    expect(
      resolveHref('/products', undefined, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        definition: def as any,
        values: { page: 2, q: 'boots' },
      })
    ).toBe('/products?page=2&q=boots');
  });

  it('omits default values from searchParams', () => {
    const def = createSearchParams({
      page: {
        parse: (v) => (v ? Number(v) : 1),
        serialize: (v) => String(v),
      },
    });

    // page=1 is the default — should be omitted
    expect(
      resolveHref('/products', undefined, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        definition: def as any,
        values: { page: 1 },
      })
    ).toBe('/products');
  });

  it('combines params and searchParams', () => {
    const def = createSearchParams({
      tab: {
        parse: (v: string | string[] | undefined): string =>
          typeof v === 'string' ? v : 'overview',
        serialize: (v: string): string | null => v,
      },
    });

    expect(
      resolveHref(
        '/products/[id]',
        { id: '42' },
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          definition: def as any,
          values: { tab: 'reviews' },
        }
      )
    ).toBe('/products/42?tab=reviews');
  });

  it('throws when searchParams and inline query string both present', () => {
    const def = createSearchParams({
      page: {
        parse: (v) => (v ? Number(v) : 1),
        serialize: (v) => String(v),
      },
    });

    expect(() =>
      resolveHref('/products?existing=true', undefined, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        definition: def as any,
        values: { page: 2 },
      })
    ).toThrow('mutually exclusive');
  });
});

// ─── buildLinkProps ─────────────────────────────────────────────

describe('buildLinkProps', () => {
  it('href validation — produces resolved href with params', () => {
    const result = buildLinkProps({
      href: '/products/[id]',
      params: { id: '42' },
    });
    expect(result.href).toBe('/products/42');
    expect(result['data-timber-link']).toBe(true);
  });

  it('searchParams serialization in output href', () => {
    const def = createSearchParams({
      q: {
        parse: (v: string | string[] | undefined): string => (typeof v === 'string' ? v : ''),
        serialize: (v: string): string | null => v || null,
      },
    });

    const result = buildLinkProps({
      href: '/search',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      searchParams: { definition: def as any, values: { q: 'boots' } },
    });
    expect(result.href).toBe('/search?q=boots');
  });

  it('params href exclusive — works with params, no string interpolation', () => {
    const result = buildLinkProps({
      href: '/users/[userId]/posts/[postId]',
      params: { userId: 'u1', postId: 'p2' },
    });
    expect(result.href).toBe('/users/u1/posts/p2');
  });

  it('search params query exclusive — throws on conflict', () => {
    const def = createSearchParams({
      page: {
        parse: (v) => (v ? Number(v) : 1),
        serialize: (v) => String(v),
      },
    });

    expect(() =>
      buildLinkProps({
        href: '/products?page=1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        searchParams: { definition: def as any, values: { page: 2 } },
      })
    ).toThrow('mutually exclusive');
  });

  it('default omission — default values not in rendered href', () => {
    const def = createSearchParams({
      page: {
        parse: (v) => (v ? Number(v) : 1),
        serialize: (v) => String(v),
      },
      sort: {
        parse: (v: string | string[] | undefined): string =>
          typeof v === 'string' ? v : 'popular',
        serialize: (v: string): string | null => v,
      },
    });

    const result = buildLinkProps({
      href: '/products',
      searchParams: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        definition: def as any,
        values: { page: 1, sort: 'popular' },
      },
    });
    // Both are defaults — href should be clean
    expect(result.href).toBe('/products');
  });

  it('security — rejects dangerous schemes after params interpolation', () => {
    expect(() => buildLinkProps({ href: 'javascript:alert(1)' })).toThrow('dangerous href');
  });

  it('external links do not get data-timber-link', () => {
    const result = buildLinkProps({ href: 'https://example.com' });
    expect(result['data-timber-link']).toBeUndefined();
  });

  it('prefetch and scroll data attributes', () => {
    const result = buildLinkProps({
      href: '/dashboard',
      prefetch: true,
      scroll: false,
    });
    expect(result['data-timber-prefetch']).toBe(true);
    expect(result['data-timber-scroll']).toBe('false');
  });
});

// ─── Codegen: typed Link overloads ──────────────────────────────

describe('codegen typed Link overloads', () => {
  const TMP_DIR = join(import.meta.dirname, '.tmp-typed-link-test');

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

  function setup() {
    mkdirSync(TMP_DIR, { recursive: true });
  }
  function teardown() {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }

  it('generates Link overloads for static and dynamic routes', () => {
    setup();
    try {
      const root = createApp({
        'page.tsx': '',
        'products/[id]/page.tsx': '',
        'about/page.tsx': '',
      });

      const tree = scanRoutes(root);
      const output = generateRouteMap(tree);

      // Static route — params?: never
      expect(output).toContain("href: '/'");
      expect(output).toContain("href: '/about'");
      expect(output).toMatch(/params\?\s*:\s*never/);

      // Dynamic route — params required
      expect(output).toContain("href: '/products/[id]'");
      expect(output).toMatch(/params\s*:\s*\{\s*id\s*:\s*string\s*\}/);

      // Fallback overload
      expect(output).toContain('LinkProps');
    } finally {
      teardown();
    }
  });

  it('generates searchParams types for routes with search-params.ts', () => {
    setup();
    try {
      const root = createApp({
        'products/page.tsx': '',
        'products/search-params.ts': `
import { createSearchParams } from '@timber/app/search-params'
export default createSearchParams({
  page: { parse: (v) => Number(v) || 1, serialize: (v) => String(v) },
})
        `.trim(),
      });

      const tree = scanRoutes(root);
      const output = generateRouteMap(tree, { appDir: root });

      // Should reference search-params import for the route type
      expect(output).toContain('search-params');
      expect(output).toContain('SearchParamsDefinition');
    } finally {
      teardown();
    }
  });
});
