import { describe, it, expect } from 'vitest';
import {
  createSearchParams,
  fromSchema,
  fromArraySchema,
  analyzeSearchParams,
  formatAnalyzeError,
} from '@timber/app/search-params';
import type { SearchParamCodec } from '@timber/app/search-params';

// ---------------------------------------------------------------------------
// Mock Standard Schema for testing (mimics Zod's ~standard interface)
// ---------------------------------------------------------------------------

/** Create a mock Standard Schema that mimics z.coerce.number().int().min(1).default(defaultVal) */
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

/** Create a mock Standard Schema for nullable string with default null */
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

/** Mock array schema */
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

// ---------------------------------------------------------------------------
// createSearchParams factory
// ---------------------------------------------------------------------------

describe('create search params', () => {
  it('creates a definition with codecs', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      q: {
        parse: (v: string | string[] | undefined) => (typeof v === 'string' ? v : null),
        serialize: (v: string | null) => v,
      },
    });

    expect(def).toBeDefined();
    expect(def.parse).toBeTypeOf('function');
    expect(def.serialize).toBeTypeOf('function');
    expect(def.href).toBeTypeOf('function');
    expect(def.toSearchParams).toBeTypeOf('function');
    expect(def.extend).toBeTypeOf('function');
    expect(def.pick).toBeTypeOf('function');
    expect(def.codecs).toBeDefined();
  });

  it('parses URLSearchParams', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      q: fromSchema(mockNullableStringSchema()),
    });

    const params = new URLSearchParams('page=3&q=boots');
    const result = def.parse(params);
    expect(result).toEqual({ page: 3, q: 'boots' });
  });

  it('parses plain record', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      q: fromSchema(mockNullableStringSchema()),
    });

    const result = def.parse({ page: '3', q: 'boots' });
    expect(result).toEqual({ page: 3, q: 'boots' });
  });

  it('returns defaults for missing params', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      q: fromSchema(mockNullableStringSchema()),
    });

    const result = def.parse(new URLSearchParams(''));
    expect(result).toEqual({ page: 1, q: null });
  });
});

// ---------------------------------------------------------------------------
// fromSchema bridge
// ---------------------------------------------------------------------------

describe('from schema zod', () => {
  it('creates a codec from a Standard Schema', () => {
    const codec = fromSchema(mockNumberSchema(1));

    expect(codec.parse('5')).toBe(5);
    expect(codec.parse(undefined)).toBe(1); // default
    expect(codec.parse('abc')).toBe(1); // parse failure → default
    expect(codec.serialize(5)).toBe('5');
    expect(codec.serialize(1)).toBe('1');
  });

  it('handles nullable string schema', () => {
    const codec = fromSchema(mockNullableStringSchema());

    expect(codec.parse('hello')).toBe('hello');
    expect(codec.parse(undefined)).toBe(null);
    expect(codec.serialize('hello')).toBe('hello');
    expect(codec.serialize(null)).toBe(null);
  });

  it('handles array input by taking last value', () => {
    const codec = fromSchema(mockNumberSchema(1));

    // When URL has repeated keys, framework passes array
    expect(codec.parse(['2', '5'])).toBe(5); // takes last
    expect(codec.parse(['abc'])).toBe(1); // fallback to default
  });
});

// ---------------------------------------------------------------------------
// SearchParamCodec protocol
// ---------------------------------------------------------------------------

describe('codec protocol', () => {
  it('supports custom inline codecs', () => {
    const sortCodec: SearchParamCodec<'asc' | 'desc'> = {
      parse: (v) => (v === 'desc' ? 'desc' : 'asc'),
      serialize: (v) => v,
    };

    const def = createSearchParams({ sort: sortCodec });
    expect(def.parse({ sort: 'desc' })).toEqual({ sort: 'desc' });
    expect(def.parse({ sort: 'invalid' })).toEqual({ sort: 'asc' });
    expect(def.parse({})).toEqual({ sort: 'asc' });
  });

  it('supports nuqs-compatible codecs', () => {
    // Simulates parseAsInteger.withDefault(1)
    const nuqsLikeCodec: SearchParamCodec<number> = {
      parse: (v) => {
        if (v === undefined || v === null) return 1;
        const str = Array.isArray(v) ? v[0] : v;
        const num = parseInt(str ?? '', 10);
        return Number.isNaN(num) ? 1 : num;
      },
      serialize: (v) => String(v),
    };

    const def = createSearchParams({ page: nuqsLikeCodec });
    expect(def.parse({ page: '5' })).toEqual({ page: 5 });
    expect(def.parse({})).toEqual({ page: 1 });
  });
});

// ---------------------------------------------------------------------------
// URL key aliasing
// ---------------------------------------------------------------------------

describe('url keys', () => {
  it('aliases URL keys to property names during parse', () => {
    const def = createSearchParams(
      {
        category: fromSchema(mockNullableStringSchema()),
        search: fromSchema(mockNullableStringSchema()),
      },
      {
        urlKeys: { category: 'cat', search: 'q' },
      }
    );

    const result = def.parse(new URLSearchParams('cat=shoes&q=boots'));
    expect(result).toEqual({ category: 'shoes', search: 'boots' });
  });

  it('serializes using URL keys', () => {
    const def = createSearchParams(
      {
        category: fromSchema(mockNullableStringSchema()),
        search: fromSchema(mockNullableStringSchema()),
      },
      {
        urlKeys: { category: 'cat', search: 'q' },
      }
    );

    const qs = def.serialize({ category: 'shoes', search: 'boots' });
    expect(qs).toContain('cat=shoes');
    expect(qs).toContain('q=boots');
    expect(qs).not.toContain('category=');
    expect(qs).not.toContain('search=');
  });

  it('href uses URL keys', () => {
    const def = createSearchParams(
      {
        category: fromSchema(mockNullableStringSchema()),
      },
      {
        urlKeys: { category: 'cat' },
      }
    );

    expect(def.href('/products', { category: 'shoes' })).toBe('/products?cat=shoes');
  });

  it('toSearchParams uses URL keys', () => {
    const def = createSearchParams(
      {
        category: fromSchema(mockNullableStringSchema()),
      },
      {
        urlKeys: { category: 'cat' },
      }
    );

    const usp = def.toSearchParams({ category: 'shoes' });
    expect(usp.get('cat')).toBe('shoes');
    expect(usp.has('category')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Default-omission
// ---------------------------------------------------------------------------

describe('default omission', () => {
  it('omits params whose serialized value matches default', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      q: fromSchema(mockNullableStringSchema()),
      category: fromSchema(mockNullableStringSchema()),
    });

    // page=1 is default, q=null is default → both omitted
    const qs = def.serialize({ page: 1, q: null, category: 'shoes' });
    expect(qs).toBe('category=shoes');
  });

  it('serializes non-default values', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
    });

    expect(def.serialize({ page: 3 })).toBe('page=3');
  });

  it('returns empty string when all values are defaults', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      q: fromSchema(mockNullableStringSchema()),
    });

    expect(def.serialize({ page: 1, q: null })).toBe('');
  });

  it('href returns pathname only when all defaults', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
    });

    expect(def.href('/products', { page: 1 })).toBe('/products');
    expect(def.href('/products', { page: 2 })).toBe('/products?page=2');
  });

  it('handles Partial<T> — missing fields are not serialized', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      q: fromSchema(mockNullableStringSchema()),
      category: fromSchema(mockNullableStringSchema()),
    });

    // Only provide category — page and q are not serialized
    expect(def.serialize({ category: 'shoes' })).toBe('category=shoes');
  });
});

// ---------------------------------------------------------------------------
// Composition — .extend() and .pick()
// ---------------------------------------------------------------------------

describe('composition', () => {
  const pagination = createSearchParams({
    page: fromSchema(mockNumberSchema(1)),
    pageSize: fromSchema(mockNumberSchema(20)),
  });

  const searchable = createSearchParams({
    q: fromSchema(mockNullableStringSchema()),
  });

  it('extend merges codecs', () => {
    const combined = pagination.extend(searchable.codecs);

    const result = combined.parse(new URLSearchParams('page=2&pageSize=50&q=boots'));
    expect(result).toEqual({ page: 2, pageSize: 50, q: 'boots' });
  });

  it('extend with URL keys', () => {
    const combined = pagination.extend(searchable.codecs, {
      urlKeys: { q: 'search' },
    });

    const result = combined.parse(new URLSearchParams('page=2&search=boots'));
    expect(result).toEqual({ page: 2, pageSize: 20, q: 'boots' });
  });

  it('extend chaining works', () => {
    const combined = pagination.extend(searchable.codecs).extend({
      category: fromSchema(mockNullableStringSchema()),
    });

    const result = combined.parse(new URLSearchParams('page=2&q=boots&category=shoes'));
    expect(result).toEqual({ page: 2, pageSize: 20, q: 'boots', category: 'shoes' });
  });

  it('pick creates a subset definition', () => {
    const combined = pagination.extend({
      q: fromSchema(mockNullableStringSchema()),
      category: fromSchema(mockNullableStringSchema()),
    });

    const picked = combined.pick('q', 'category');
    const result = picked.parse(new URLSearchParams('q=boots&category=shoes'));
    expect(result).toEqual({ q: 'boots', category: 'shoes' });

    // pageSize is NOT in picked
    expect(Object.keys(picked.codecs)).toEqual(['q', 'category']);
  });

  it('pick preserves URL key aliases', () => {
    const def = createSearchParams(
      {
        search: fromSchema(mockNullableStringSchema()),
        page: fromSchema(mockNumberSchema(1)),
      },
      { urlKeys: { search: 'q' } }
    );

    const picked = def.pick('search');
    expect(picked.parse(new URLSearchParams('q=boots'))).toEqual({ search: 'boots' });
    expect(picked.serialize({ search: 'boots' })).toBe('q=boots');
  });

  it('codecs accessor does not carry aliases', () => {
    const def = createSearchParams(
      {
        search: fromSchema(mockNullableStringSchema()),
      },
      { urlKeys: { search: 'q' } }
    );

    // Spread codecs into a new definition — alias not inherited
    const newDef = createSearchParams(def.codecs);
    // Without alias, property name is used as URL key
    expect(newDef.serialize({ search: 'boots' })).toBe('search=boots');
  });
});

// ---------------------------------------------------------------------------
// nuqs compatibility
// ---------------------------------------------------------------------------

describe('nuqs compat', () => {
  it('nuqs parsers work as SearchParamCodec values', () => {
    // Simulates parseAsInteger.withDefault(1)
    const parseAsInteger = {
      parse: (v: string | string[] | undefined) => {
        const str = Array.isArray(v) ? v[0] : v;
        if (str === undefined) return 1;
        const num = parseInt(str, 10);
        return Number.isNaN(num) ? 1 : num;
      },
      serialize: (v: number) => String(v),
    };

    // Simulates parseAsString.withDefault('')
    const parseAsString = {
      parse: (v: string | string[] | undefined) => {
        const str = Array.isArray(v) ? v[0] : v;
        return str ?? '';
      },
      serialize: (v: string) => v || null,
    };

    const def = createSearchParams({
      page: parseAsInteger,
      q: parseAsString,
    });

    expect(def.parse(new URLSearchParams('page=5&q=hello'))).toEqual({
      page: 5,
      q: 'hello',
    });
    expect(def.parse(new URLSearchParams(''))).toEqual({ page: 1, q: '' });
  });
});

// ---------------------------------------------------------------------------
// Auto-parsing (framework integration point)
// ---------------------------------------------------------------------------

describe('auto parsing', () => {
  it('parse works with URLSearchParams from a real request', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      category: fromSchema(mockNullableStringSchema()),
    });

    // Simulates what the framework does in page.tsx/middleware.ts/access.ts
    const url = new URL('https://example.com/products?page=3&category=shoes');
    const parsed = def.parse(url.searchParams);
    expect(parsed).toEqual({ page: 3, category: 'shoes' });
  });

  it('parse handles malformed input gracefully', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
    });

    // Bad value falls back to default
    expect(def.parse(new URLSearchParams('page=not-a-number'))).toEqual({ page: 1 });
    // Missing falls back to default
    expect(def.parse(new URLSearchParams(''))).toEqual({ page: 1 });
  });

  it('parse handles repeated keys', () => {
    const def = createSearchParams({
      tags: fromArraySchema(mockArraySchema([])),
    });

    const params = new URLSearchParams();
    params.append('tags', 'a');
    params.append('tags', 'b');
    const result = def.parse(params);
    expect(result).toEqual({ tags: ['a', 'b'] });
  });
});

// ---------------------------------------------------------------------------
// fromArraySchema
// ---------------------------------------------------------------------------

describe('fromArraySchema', () => {
  it('parses array from repeated keys', () => {
    const codec = fromArraySchema(mockArraySchema([]));
    expect(codec.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('coerces single string to array', () => {
    const codec = fromArraySchema(mockArraySchema([]));
    expect(codec.parse('hello')).toEqual(['hello']);
  });

  it('returns default for undefined', () => {
    const codec = fromArraySchema(mockArraySchema([]));
    expect(codec.parse(undefined)).toEqual([]);
  });

  it('serializes arrays as comma-separated', () => {
    const codec = fromArraySchema(mockArraySchema([]));
    expect(codec.serialize(['a', 'b'])).toBe('a,b');
    expect(codec.serialize([])).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Static analyzability — analyzeSearchParams
// ---------------------------------------------------------------------------

describe('non-analyzable error', () => {
  it('accepts createSearchParams() call', () => {
    const source = `
      import { createSearchParams, fromSchema } from '@timber/app/search-params'
      import { z } from 'zod'

      export default createSearchParams({
        page: fromSchema(z.coerce.number().default(1)),
      })
    `;
    const result = analyzeSearchParams(source, '/app/products/search-params.ts');
    expect(result.valid).toBe(true);
  });

  it('accepts .extend() chain', () => {
    const source = `
      import { pagination } from '@/lib/search-params/pagination'

      export default pagination.extend({
        category: fromSchema(z.string().default(null)),
      })
    `;
    expect(analyzeSearchParams(source, 'test.ts').valid).toBe(true);
  });

  it('accepts .pick() chain', () => {
    const source = `
      import def from './base'
      export default def.pick('page', 'q')
    `;
    expect(analyzeSearchParams(source, 'test.ts').valid).toBe(true);
  });

  it('accepts createSearchParams().extend().pick() chain', () => {
    const source = `
      export default createSearchParams({ page: codec }).extend({ q: codec2 }).pick('page')
    `;
    expect(analyzeSearchParams(source, 'test.ts').valid).toBe(true);
  });

  it('rejects arbitrary factory function', () => {
    const source = `
      export default makeParams('products')
    `;
    const result = analyzeSearchParams(source, '/app/products/search-params.ts');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.filePath).toBe('/app/products/search-params.ts');
  });

  it('rejects ternary conditional', () => {
    const source = `
      export default isAdmin ? adminParams : userParams
    `;
    // Note: this doesn't contain .extend or .pick, so it fails
    const result = analyzeSearchParams(source, 'test.ts');
    expect(result.valid).toBe(false);
  });

  it('rejects missing default export', () => {
    const source = `
      export const params = createSearchParams({ page: codec })
    `;
    const result = analyzeSearchParams(source, 'test.ts');
    expect(result.valid).toBe(false);
    expect(result.error!.expression).toBe('(no default export found)');
  });

  it('formats error message with file path and suggestion', () => {
    const source = `export default makeParams('products')`;
    const result = analyzeSearchParams(source, '/app/products/search-params.ts');
    expect(result.valid).toBe(false);

    const message = formatAnalyzeError(result.error!);
    expect(message).toContain('/app/products/search-params.ts');
    expect(message).toContain('createSearchParams()');
    expect(message).toContain('statically extract');
  });
});

// ---------------------------------------------------------------------------
// useQueryStates (server-side throws)
// ---------------------------------------------------------------------------

describe('useQueryStates server-side', () => {
  it('throws when called outside a client component', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
    });

    expect(() => def.useQueryStates()).toThrow('client component');
  });
});

// ---------------------------------------------------------------------------
// Edge cases and security
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles empty URLSearchParams', () => {
    const def = createSearchParams({
      page: fromSchema(mockNumberSchema(1)),
      q: fromSchema(mockNullableStringSchema()),
    });

    expect(def.parse(new URLSearchParams())).toEqual({ page: 1, q: null });
  });

  it('handles URL-encoded values', () => {
    const def = createSearchParams({
      q: fromSchema(mockNullableStringSchema()),
    });

    // URLSearchParams handles decoding
    const params = new URLSearchParams('q=hello%20world');
    expect(def.parse(params)).toEqual({ q: 'hello world' });
  });

  it('serialize URL-encodes values', () => {
    const def = createSearchParams({
      q: fromSchema(mockNullableStringSchema()),
    });

    const qs = def.serialize({ q: 'hello world' });
    expect(qs).toBe('q=hello%20world');
  });

  it('handles special characters in URL keys', () => {
    const def = createSearchParams(
      {
        itemsPerPage: fromSchema(mockNumberSchema(20)),
      },
      { urlKeys: { itemsPerPage: 'limit' } }
    );

    expect(def.parse(new URLSearchParams('limit=50'))).toEqual({ itemsPerPage: 50 });
    expect(def.serialize({ itemsPerPage: 50 })).toBe('limit=50');
  });
});
