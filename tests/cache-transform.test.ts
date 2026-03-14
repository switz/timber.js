import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  transformUseCache,
  parseCacheLife,
  detectPromiseParamsWarning,
} from '../packages/timber-app/src/plugins/cache-transform';
import { registerCachedFunction } from '../packages/timber-app/src/cache/index';
import { MemoryCacheHandler } from '../packages/timber-app/src/cache/index';

// ---------------------------------------------------------------------------
// Transform: 'use cache' directive detection and rewriting
// ---------------------------------------------------------------------------

describe('transformUseCache', () => {
  it('transform directive: rewrites function with use cache to registerCachedFunction', () => {
    const code = `
async function PopularProducts() {
  'use cache'
  const products = await db.products.findPopular()
  return products
}
`;
    const result = transformUseCache(code, 'app/components/PopularProducts.tsx');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('registerCachedFunction');
    expect(result!.code).toContain("'app/components/PopularProducts.tsx#PopularProducts'");
    // The 'use cache' directive should be removed from the function body
    expect(result!.code).not.toMatch(/'use cache'/);
  });

  it('transform directive: rewrites exported async function', () => {
    const code = `
export async function getProducts() {
  'use cache'
  return await db.products.findAll()
}
`;
    const result = transformUseCache(code, 'app/data.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('registerCachedFunction');
    expect(result!.code).toContain("'app/data.ts#getProducts'");
  });

  it('transform directive: rewrites export default async function', () => {
    const code = `
export default async function Dashboard() {
  'use cache'
  const stats = await getStats()
  return stats
}
`;
    const result = transformUseCache(code, 'app/dashboard/page.tsx');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('registerCachedFunction');
    expect(result!.code).toContain("'app/dashboard/page.tsx#Dashboard'");
  });

  it('transform directive: rewrites arrow function assigned to const', () => {
    const code = `
const fetchData = async () => {
  'use cache'
  return await db.query()
}
`;
    const result = transformUseCache(code, 'app/utils.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('registerCachedFunction');
    expect(result!.code).toContain("'app/utils.ts#fetchData'");
  });

  it('cache life: extracts cacheLife and converts to TTL', () => {
    const code = `
async function Cached() {
  'use cache'
  cacheLife('1h')
  return await getData()
}
`;
    const result = transformUseCache(code, 'app/page.tsx');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('ttl: 3600');
    // cacheLife call should be removed from the function body
    expect(result!.code).not.toContain('cacheLife');
  });

  it('cache life: supports various duration formats', () => {
    expect(parseCacheLife('30s')).toBe(30);
    expect(parseCacheLife('5m')).toBe(300);
    expect(parseCacheLife('1h')).toBe(3600);
    expect(parseCacheLife('2d')).toBe(172800);
    expect(parseCacheLife('1w')).toBe(604800);
  });

  it('cache life: supports numeric seconds', () => {
    const code = `
async function Cached() {
  'use cache'
  cacheLife(300)
  return await getData()
}
`;
    const result = transformUseCache(code, 'app/page.tsx');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('ttl: 300');
  });

  it('cache life: defaults TTL when no cacheLife call', () => {
    const code = `
async function Cached() {
  'use cache'
  return await getData()
}
`;
    const result = transformUseCache(code, 'app/page.tsx');
    expect(result).not.toBeNull();
    // Default TTL should be used (design doc doesn't specify, use Infinity/0 or a sensible default)
    expect(result!.code).toContain('ttl:');
  });

  it('component key: uses props as cache key for components (PascalCase)', () => {
    const code = `
async function UserProfile({ userId }) {
  'use cache'
  return await getUser(userId)
}
`;
    const result = transformUseCache(code, 'app/components/UserProfile.tsx');
    expect(result).not.toBeNull();
    // Component detected by PascalCase name — uses props as cache key
    expect(result!.code).toContain("'app/components/UserProfile.tsx#UserProfile'");
    expect(result!.code).toContain('registerCachedFunction');
  });

  it('function key: uses args as cache key for regular functions (camelCase)', () => {
    const code = `
async function getUser(userId) {
  'use cache'
  return await db.users.find(userId)
}
`;
    const result = transformUseCache(code, 'app/data.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain("'app/data.ts#getUser'");
    expect(result!.code).toContain('registerCachedFunction');
  });

  it('does not transform functions without use cache', () => {
    const code = `
async function normalFunction() {
  return await getData()
}
`;
    const result = transformUseCache(code, 'app/page.tsx');
    expect(result).toBeNull();
  });

  it('handles multiple functions, only transforms those with use cache', () => {
    const code = `
async function cachedFn() {
  'use cache'
  cacheLife('5m')
  return await getData()
}

async function normalFn() {
  return await getOtherData()
}

async function anotherCachedFn() {
  'use cache'
  return await getMoreData()
}
`;
    const result = transformUseCache(code, 'app/data.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain("'app/data.ts#cachedFn'");
    expect(result!.code).toContain("'app/data.ts#anotherCachedFn'");
    // normalFn should remain untouched
    expect(result!.code).toContain('async function normalFn()');
    expect(result!.code).not.toContain('data.ts#normalFn');
  });

  it('adds registerCachedFunction import when transforming', () => {
    const code = `
async function Cached() {
  'use cache'
  return await getData()
}
`;
    const result = transformUseCache(code, 'app/page.tsx');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('import { registerCachedFunction }');
  });

  it('handles "use cache" with double quotes', () => {
    const code = `
async function Cached() {
  "use cache"
  return await getData()
}
`;
    const result = transformUseCache(code, 'app/page.tsx');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('registerCachedFunction');
  });
});

// ---------------------------------------------------------------------------
// Promise params warning for 'use cache' in dynamic routes
// ---------------------------------------------------------------------------

describe('detectPromiseParamsWarning', () => {
  it('warns for page with Promise params in dynamic route', () => {
    const warning = detectPromiseParamsWarning(
      'async function Page({ params }: { params: Promise<{ slug: string }> })',
      'Page',
      'app/[slug]/page.tsx'
    );
    expect(warning).not.toBeNull();
    expect(warning!.message).toContain('Promise params');
    expect(warning!.functionName).toBe('Page');
  });

  it('warns for layout with Promise params in dynamic route', () => {
    const warning = detectPromiseParamsWarning(
      'async function Layout({ params }: { params: Promise<{ id: string }> })',
      'Layout',
      'app/[id]/layout.tsx'
    );
    expect(warning).not.toBeNull();
  });

  it('does not warn for static route page', () => {
    const warning = detectPromiseParamsWarning(
      'async function Page({ params }: { params: Promise<{ slug: string }> })',
      'Page',
      'app/about/page.tsx'
    );
    expect(warning).toBeNull();
  });

  it('does not warn for page without Promise params', () => {
    const warning = detectPromiseParamsWarning(
      'async function Page()',
      'Page',
      'app/[slug]/page.tsx'
    );
    expect(warning).toBeNull();
  });

  it('does not warn for non-page files in dynamic routes', () => {
    const warning = detectPromiseParamsWarning(
      'async function getData(params: Promise<{ id: string }>)',
      'getData',
      'app/[id]/data.ts'
    );
    expect(warning).toBeNull();
  });

  it('warns for nested dynamic route', () => {
    const warning = detectPromiseParamsWarning(
      'async function Page({ params }: { params: Promise<{ section: string }> })',
      'Page',
      'app/dashboard/[section]/page.tsx'
    );
    expect(warning).not.toBeNull();
  });

  it('warns for catch-all dynamic route', () => {
    const warning = detectPromiseParamsWarning(
      'async function Page({ params }: { params: Promise<{ slug: string[] }> })',
      'Page',
      'app/[...slug]/page.tsx'
    );
    expect(warning).not.toBeNull();
  });
});

describe('transformUseCache with Promise params warning', () => {
  it('returns warnings for use cache function with Promise params in dynamic route', () => {
    const code = `
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  'use cache'
  const { slug } = await params
  return <div>{slug}</div>
}
`;
    const result = transformUseCache(code, 'app/[slug]/page.tsx');
    expect(result).not.toBeNull();
    expect(result!.warnings).toBeDefined();
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings![0].message).toContain('Promise params');
  });

  it('does not return warnings for use cache in static route', () => {
    const code = `
async function PopularProducts() {
  'use cache'
  return await getProducts()
}
`;
    const result = transformUseCache(code, 'app/products/page.tsx');
    expect(result).not.toBeNull();
    expect(result!.warnings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// registerCachedFunction runtime
// ---------------------------------------------------------------------------

describe('registerCachedFunction', () => {
  let handler: MemoryCacheHandler;

  beforeEach(() => {
    handler = new MemoryCacheHandler();
  });

  it('caches function results by args', async () => {
    let callCount = 0;
    const fn = async (id: string) => {
      callCount++;
      return { id, count: callCount };
    };

    const cached = registerCachedFunction(fn, { ttl: 60, id: 'test#fn' }, handler);

    const a = await cached('abc');
    const b = await cached('abc');
    expect(callCount).toBe(1);
    expect(a).toEqual(b);
  });

  it('uses stable ID for cache key generation', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return `value-${callCount}`;
    };

    const cached1 = registerCachedFunction(fn, { ttl: 60, id: 'module#fn1' }, handler);
    const cached2 = registerCachedFunction(fn, { ttl: 60, id: 'module#fn2' }, handler);

    await cached1();
    await cached2();
    // Different IDs → different cache entries
    expect(callCount).toBe(2);
  });

  it('revalidate tag: invalidation works via revalidateTag', async () => {
    let callCount = 0;
    const fn = async (_category: string) => {
      callCount++;
      return `products-${callCount}`;
    };

    const cached = registerCachedFunction(
      fn,
      { ttl: 60, id: 'test#getProducts', tags: (cat: string) => [`products:${cat}`] },
      handler
    );

    await cached('shoes');
    expect(callCount).toBe(1);

    // Invalidate by tag
    await handler.invalidate({ tag: 'products:shoes' });
    await cached('shoes');
    expect(callCount).toBe(2);
  });

  it('request props warning: warns in dev when component props look request-specific', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const fn = async (props: { userId: string; cookies: string }) => {
      return `user-${props.userId}`;
    };

    // isComponent=true triggers the warning check
    const cached = registerCachedFunction(
      fn,
      { ttl: 60, id: 'test#UserWidget', isComponent: true },
      handler
    );

    await cached({ userId: '123', cookies: 'session=abc' });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('request-specific'));

    warn.mockRestore();
  });
});
