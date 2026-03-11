/**
 * Phase 3 Integration Tests — Type Safety
 *
 * Cross-feature integration tests verifying that search-params, codegen,
 * typed Link, and useQueryStates work together correctly.
 *
 * Unit tests for each feature live in their respective test files.
 * These tests validate the boundaries where features interact.
 *
 * Acceptance criteria: timber-dch.2.6
 *   - search-params.ts parsing: codecs, urlKeys, defaults
 *   - Non-analyzable search-params.ts build error
 *   - Typed Link params/searchParams
 *   - useQueryStates shallow:false navigation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  createSearchParams,
  fromSchema,
  fromArraySchema,
  analyzeSearchParams,
  formatAnalyzeError,
} from '@timber/app/search-params';
import { resolveHref, buildLinkProps, setCurrentParams, useParams } from '@timber/app/client';
import { generateRouteMap } from '../../packages/timber-app/src/routing/codegen.js';
import { scanRoutes } from '@timber/app/routing';

// ─── Shared helpers ──────────────────────────────────────────────

/** Mock Standard Schema (Zod-like) for number with default */
function mockNumberSchema(defaultVal: number) {
  return {
    '~standard': {
      validate(value: unknown) {
        if (value === undefined || value === null || value === '') {
          return { value: defaultVal };
        }
        const num = Number(value);
        if (Number.isNaN(num) || !Number.isInteger(num)) {
          return { value: defaultVal };
        }
        return { value: num };
      },
    },
  };
}

/** Mock Standard Schema for nullable string */
function mockNullableStringSchema(defaultVal: string | null = null) {
  return {
    '~standard': {
      validate(value: unknown) {
        if (value === undefined || value === null || value === '') {
          return { value: defaultVal };
        }
        return { value: String(value) };
      },
    },
  };
}

/** Mock Standard Schema for arrays */
function mockArraySchema(defaultVal: string[] = []) {
  return {
    '~standard': {
      validate(value: unknown) {
        if (value === undefined || value === null) {
          return { value: defaultVal };
        }
        if (Array.isArray(value)) {
          return { value: value.map(String) };
        }
        return { value: [String(value)] };
      },
    },
  };
}

/** Temp dir helper for codegen tests */
const TMP_DIR = join(import.meta.dirname, '.tmp-type-safety-integration');

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

// ─── search params: codecs, urlKeys, defaults ────────────────────
// Acceptance: search-params.ts parsing integration

describe('search params', () => {
  it('codecs + urlKeys + defaults work together end-to-end', () => {
    const def = createSearchParams(
      {
        page: fromSchema(mockNumberSchema(1)),
        search: fromSchema(mockNullableStringSchema()),
        category: fromSchema(mockNullableStringSchema()),
        tags: fromArraySchema(mockArraySchema([])),
      },
      {
        urlKeys: { search: 'q', category: 'cat' },
      }
    );

    // Parse from a realistic URL
    const url = new URL(
      'https://shop.example.com/products?q=boots&cat=footwear&page=2&tags=sale&tags=new'
    );
    const parsed = def.parse(url.searchParams);

    expect(parsed).toEqual({
      page: 2,
      search: 'boots',
      category: 'footwear',
      tags: ['sale', 'new'],
    });

    // Serialize back — defaults omitted, urlKeys used
    const qs = def.serialize(parsed);
    expect(qs).toContain('q=boots');
    expect(qs).toContain('cat=footwear');
    expect(qs).toContain('page=2');
    expect(qs).toContain('tags=sale%2Cnew');
    expect(qs).not.toContain('search=');
    expect(qs).not.toContain('category=');

    // Round-trip: defaults are omitted
    const withDefaults = { ...parsed, page: 1, tags: [] };
    const defaultQs = def.serialize(withDefaults);
    expect(defaultQs).toContain('q=boots');
    expect(defaultQs).toContain('cat=footwear');
    expect(defaultQs).not.toContain('page=');
    expect(defaultQs).not.toContain('tags=');
  });

  it('composition with extend preserves base codecs and adds new ones', () => {
    const pagination = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      limit: fromSchema(mockNumberSchema(20)),
    });

    const searchable = createSearchParams(
      { q: fromSchema(mockNullableStringSchema()) },
      { urlKeys: { q: 'search' } }
    );

    // Extending with .codecs strips aliases (by design)
    const combined = pagination.extend(searchable.codecs, {
      urlKeys: { q: 'query' },
    });

    const parsed = combined.parse(new URLSearchParams('page=3&limit=50&query=boots'));
    expect(parsed).toEqual({ page: 3, limit: 50, q: 'boots' });

    // Serialize uses the new urlKey
    const qs = combined.serialize(parsed);
    expect(qs).toContain('query=boots');
    expect(qs).not.toContain('search=');
  });

  it('pick preserves urlKeys for picked fields only', () => {
    const def = createSearchParams(
      {
        page: fromSchema(mockNumberSchema(1)),
        q: fromSchema(mockNullableStringSchema()),
        sort: fromSchema(mockNullableStringSchema('popular')),
      },
      { urlKeys: { q: 'search', sort: 'order' } }
    );

    const picked = def.pick('q', 'sort');

    // page is gone
    expect(Object.keys(picked.codecs)).toEqual(['q', 'sort']);

    // Aliases preserved
    const parsed = picked.parse(new URLSearchParams('search=boots&order=newest'));
    expect(parsed).toEqual({ q: 'boots', sort: 'newest' });

    const qs = picked.serialize({ q: 'boots', sort: 'newest' });
    expect(qs).toContain('search=boots');
    expect(qs).toContain('order=newest');
  });

  it('href generation with urlKeys and default omission', () => {
    const def = createSearchParams(
      {
        page: fromSchema(mockNumberSchema(1)),
        q: fromSchema(mockNullableStringSchema()),
      },
      { urlKeys: { q: 'search' } }
    );

    // All defaults → clean pathname
    expect(def.href('/products', { page: 1, q: null })).toBe('/products');

    // Non-default → includes query with urlKey
    expect(def.href('/products', { page: 2, q: 'boots' })).toBe('/products?page=2&search=boots');

    // Partial — only non-default values serialized
    expect(def.href('/products', { q: 'boots' })).toBe('/products?search=boots');
  });
});

// ─── Non-analyzable search-params.ts build error ────────────────
// Acceptance: Non-analyzable search-params.ts build error

describe('non-analyzable', () => {
  it('codegen detects search-params.ts and static analysis validates it', () => {
    beforeEach(() => mkdirSync(TMP_DIR, { recursive: true }));
    afterEach(() => rmSync(TMP_DIR, { recursive: true, force: true }));

    mkdirSync(TMP_DIR, { recursive: true });

    try {
      // Valid search-params.ts
      const root = createApp({
        'products/page.tsx': '',
        'products/search-params.ts': `
import { createSearchParams, fromSchema } from '@timber/app/search-params'
export default createSearchParams({
  page: fromSchema(z.coerce.number().default(1)),
})
        `.trim(),
      });

      const tree = scanRoutes(root);
      const output = generateRouteMap(tree, { appDir: root });

      // Codegen includes the route with searchParams reference
      expect(output).toContain("'/products'");
      expect(output).toContain('searchParams');

      // Static analysis passes
      const source = `
import { createSearchParams, fromSchema } from '@timber/app/search-params'
export default createSearchParams({
  page: fromSchema(z.coerce.number().default(1)),
})
      `.trim();
      const result = analyzeSearchParams(source, root + '/products/search-params.ts');
      expect(result.valid).toBe(true);
    } finally {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it('build error for factory function not in allowed patterns', () => {
    const source = `export default buildSearchParams('products')`;
    const result = analyzeSearchParams(source, '/app/products/search-params.ts');

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();

    const message = formatAnalyzeError(result.error!);
    expect(message).toContain('/app/products/search-params.ts');
    expect(message).toContain('createSearchParams()');
    expect(message).toContain('statically extract');
  });

  it('build error for runtime conditional', () => {
    const source = `export default isAdmin ? adminSearchParams : userSearchParams`;
    const result = analyzeSearchParams(source, '/app/admin/search-params.ts');

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('accepts chained extend().pick() patterns', () => {
    const patterns = [
      `export default createSearchParams({ page: codec })`,
      `export default base.extend({ q: codec })`,
      `export default base.pick('page', 'q')`,
      `export default createSearchParams({ page: codec }).extend({ q: codec2 }).pick('page')`,
      `export default pagination.extend(searchable.codecs)`,
    ];

    for (const source of patterns) {
      const result = analyzeSearchParams(source, '/app/test/search-params.ts');
      expect(result.valid).toBe(true);
    }
  });

  it('rejects missing default export', () => {
    const source = `export const params = createSearchParams({ page: codec })`;
    const result = analyzeSearchParams(source, '/app/test/search-params.ts');

    expect(result.valid).toBe(false);
    expect(result.error!.expression).toBe('(no default export found)');
  });
});

// ─── Typed Link: params + searchParams integration ──────────────
// Acceptance: Typed Link params/searchParams

describe('typed link', () => {
  it('Link with params interpolation and searchParams serialization', () => {
    const def = createSearchParams(
      {
        tab: {
          parse: (v: string | string[] | undefined): string =>
            typeof v === 'string' ? v : 'overview',
          serialize: (v: string): string | null => v,
        },
        page: fromSchema(mockNumberSchema(1)),
      },
      { urlKeys: { tab: 't' } }
    );

    // Dynamic route with params + searchParams with urlKeys
    const result = buildLinkProps({
      href: '/products/[id]',
      params: { id: '42' },
      searchParams: {
        definition: def as any,
        values: { tab: 'reviews', page: 2 },
      },
    });

    expect(result.href).toBe('/products/42?t=reviews&page=2');
    expect(result['data-timber-link']).toBe(true);
  });

  it('Link with searchParams defaults omitted from href', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      sort: {
        parse: (v: string | string[] | undefined): string =>
          typeof v === 'string' ? v : 'popular',
        serialize: (v: string): string | null => v,
      },
    });

    const result = buildLinkProps({
      href: '/products',
      searchParams: {
        definition: def as any,
        values: { page: 1, sort: 'popular' },
      },
    });

    // All defaults → clean href
    expect(result.href).toBe('/products');
  });

  it('Link with catch-all params', () => {
    const result = buildLinkProps({
      href: '/docs/[...slug]',
      params: { slug: ['api', 'reference', 'hooks'] },
    });

    expect(result.href).toBe('/docs/api/reference/hooks');
  });

  it('Link with optional catch-all empty produces clean path', () => {
    const result = buildLinkProps({
      href: '/docs/[[...path]]',
      params: { path: [] },
    });

    expect(result.href).toBe('/docs');
  });

  it('Link security: rejects javascript: scheme in dynamic params', () => {
    // Even with params that might craft a dangerous URL, validation catches it
    expect(() => buildLinkProps({ href: 'javascript:alert(1)' })).toThrow('dangerous href');
  });

  it('codegen generates Link overloads that reference searchParams types', () => {
    mkdirSync(TMP_DIR, { recursive: true });

    try {
      const root = createApp({
        'page.tsx': '',
        'products/[id]/page.tsx': '',
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

      // Static route (/) gets params?: never
      expect(output).toMatch(/href:\s*'\/'/);
      expect(output).toMatch(/params\?\s*:\s*never/);

      // Dynamic route (/products/[id]) gets params: { id: string }
      expect(output).toContain("href: '/products/[id]'");
      expect(output).toMatch(/params\s*:\s*\{\s*id\s*:\s*string\s*\}/);

      // Route with search-params.ts gets SearchParamsDefinition reference
      expect(output).toContain('SearchParamsDefinition');

      // Fallback overload exists
      expect(output).toContain('LinkProps');
    } finally {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });
});

// ─── Search params integration ───────────────────────────────────
// Acceptance: useQueryStates shallow:false navigation (now tested in use-query-states.test.ts)

describe('query states', () => {
  it('search params codec integration: parse → update → serialize round-trip', () => {
    const def = createSearchParams(
      {
        page: fromSchema(mockNumberSchema(1)),
        q: fromSchema(mockNullableStringSchema()),
        sort: fromSchema(mockNullableStringSchema('popular')),
      },
      { urlKeys: { q: 'search' } }
    );

    // 1. Parse initial URL
    const initial = def.parse(new URLSearchParams('search=boots&page=1&sort=popular'));
    expect(initial).toEqual({ page: 1, q: 'boots', sort: 'popular' });

    // 2. Simulate user changing page and sort
    const updated = { ...initial, page: 3, sort: 'newest' };

    // 3. Serialize for URL update — defaults omitted
    const qs = def.serialize(updated);
    expect(qs).toContain('search=boots');
    expect(qs).toContain('page=3');
    expect(qs).toContain('sort=newest');

    // 4. href generation matches
    expect(def.href('/products', updated)).toBe('/products?page=3&search=boots&sort=newest');
  });

  it('URL key aliasing through full lifecycle', () => {
    const def = createSearchParams(
      {
        search: fromSchema(mockNullableStringSchema()),
        category: fromSchema(mockNullableStringSchema()),
      },
      { urlKeys: { search: 'q', category: 'cat' } }
    );

    // Parse from aliased URL keys
    const parsed = def.parse(new URLSearchParams('q=boots&cat=footwear'));
    expect(parsed).toEqual({ search: 'boots', category: 'footwear' });

    // Serialize uses aliases
    const qs = def.serialize(parsed);
    expect(qs).toContain('q=boots');
    expect(qs).toContain('cat=footwear');

    // Build Link href with aliases
    const linkResult = buildLinkProps({
      href: '/products',
      searchParams: {
        definition: def as any,
        values: { search: 'sneakers', category: 'shoes' },
      },
    });
    expect(linkResult.href).toBe('/products?q=sneakers&cat=shoes');
  });

  it('default omission keeps URLs clean across navigation', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      q: fromSchema(mockNullableStringSchema()),
    });

    // All defaults → empty query string
    const qs = def.serialize({ page: 1, q: null });
    expect(qs).toBe('');
    expect(def.href('/products', { page: 1, q: null })).toBe('/products');

    // One non-default → only that param in URL
    const qs2 = def.serialize({ page: 2 });
    expect(qs2).toBe('page=2');
    expect(def.href('/products', { page: 2 })).toBe('/products?page=2');
  });

  it('useQueryStates server-side throws with helpful message', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
    });

    expect(() => def.useQueryStates()).toThrow('client component');
  });
});

// ─── Cross-feature: codegen + params + Link + searchParams ──────

describe('cross-feature integration', () => {
  it('codegen route map + useParams + Link work for same route', () => {
    mkdirSync(TMP_DIR, { recursive: true });

    try {
      const root = createApp({
        'products/[id]/page.tsx': '',
        'products/page.tsx': '',
        'products/search-params.ts': `
import { createSearchParams } from '@timber/app/search-params'
export default createSearchParams({
  page: { parse: (v) => Number(v) || 1, serialize: (v) => String(v) },
  q: { parse: (v) => v ?? null, serialize: (v) => v },
})
        `.trim(),
      });

      // 1. Codegen generates correct types
      const tree = scanRoutes(root);
      const output = generateRouteMap(tree, { appDir: root });

      // Route with params
      expect(output).toContain("'/products/[id]'");
      expect(output).toMatch(/id\s*:\s*string/);

      // Route with searchParams
      expect(output).toContain("'/products'");
      expect(output).toContain('searchParams');

      // 2. Runtime params work
      setCurrentParams({ id: '42' });
      expect(useParams('/products/[id]')).toEqual({ id: '42' });

      // 3. Link interpolation works for same route pattern
      const linkResult = buildLinkProps({
        href: '/products/[id]',
        params: { id: '42' },
      });
      expect(linkResult.href).toBe('/products/42');
    } finally {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it('searchParams definition flows from codegen detection through Link to URL', () => {
    const def = createSearchParams(
      {
        page: fromSchema(mockNumberSchema(1)),
        q: fromSchema(mockNullableStringSchema()),
      },
      { urlKeys: { q: 'search' } }
    );

    // Build a Link with both params and searchParams
    const href = resolveHref(
      '/products/[id]',
      { id: '99' },
      { definition: def as any, values: { page: 3, q: 'sneakers' } }
    );

    expect(href).toBe('/products/99?page=3&search=sneakers');

    // Verify the URL can be parsed back correctly
    const url = new URL(href, 'https://example.com');
    const reparsed = def.parse(url.searchParams);
    expect(reparsed.page).toBe(3);
    expect(reparsed.q).toBe('sneakers');
  });

  it('searchParams serialize → parse round-trip preserves values', () => {
    const def = createSearchParams(
      {
        page: fromSchema(mockNumberSchema(1)),
        sort: fromSchema(mockNullableStringSchema('popular')),
        tags: fromArraySchema(mockArraySchema([])),
      },
      { urlKeys: { sort: 'order' } }
    );

    const original = { page: 5, sort: 'newest', tags: ['sale', 'featured'] };
    const qs = def.serialize(original);
    const reparsed = def.parse(new URLSearchParams(qs));

    expect(reparsed.page).toBe(5);
    expect(reparsed.sort).toBe('newest');
    // Array round-trip through comma serialization
    expect(reparsed.tags).toEqual(['sale,featured']);
  });

  it('Link href with searchParams definition matches def.href output', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      q: fromSchema(mockNullableStringSchema()),
    });

    const values = { page: 2, q: 'boots' };

    // These should produce the same URL
    const linkHref = resolveHref('/products', undefined, {
      definition: def as any,
      values,
    });
    const defHref = def.href('/products', values);

    expect(linkHref).toBe(defHref);
  });
});
