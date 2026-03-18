/**
 * Phase 4 Integration Tests — Caching
 *
 * Cross-feature integration tests validating the complete caching system:
 * timber.cache (createCache) + 'use cache' (registerCachedFunction) + CacheHandler
 * working together end-to-end.
 *
 * Unit tests for each caching component live in their respective test files:
 *   - tests/timber-cache.test.ts (createCache, stableStringify, singleflight)
 *   - tests/cache-handler.test.ts (MemoryCacheHandler, LRU)
 *   - tests/redis-cache-handler.test.ts (RedisCacheHandler)
 *   - tests/cache-transform.test.ts ('use cache' directive transform)
 *
 * These tests validate boundaries where features interact.
 *
 * Acceptance criteria: timber-dch.3.4
 *   - Cache HIT/MISS/STALE paths end-to-end
 *   - Singleflight concurrent
 *   - SWR full cycle
 *   - 'use cache' component uses same handler
 *   - Tag invalidation across both spellings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryCacheHandler } from '@timber-js/app/cache';
import { createCache } from '../../packages/timber-app/src/cache/timber-cache';
import { registerCachedFunction } from '../../packages/timber-app/src/cache/register-cached-function';
import { executeAction, revalidateTag } from '../../packages/timber-app/src/server/actions';

// ─── Helpers ────────────────────────────────────────────────────────────

/** Create a spy function that tracks call count and returns incrementing values. */
function createDataFetcher(prefix = 'value') {
  let callCount = 0;
  const fn = vi.fn(async (..._args: unknown[]) => {
    callCount++;
    return `${prefix}-${callCount}`;
  });
  return { fn, getCallCount: () => callCount };
}

/** Small delay to push past TTL=0 boundaries. */
function tick(ms = 15) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Cache HIT / MISS / STALE paths end-to-end ─────────────────────────
// Acceptance: Cache HIT/MISS/STALE paths end-to-end

describe('cache paths', () => {
  let handler: MemoryCacheHandler;

  beforeEach(() => {
    handler = new MemoryCacheHandler();
  });

  it('MISS → HIT → STALE lifecycle with shared handler', async () => {
    const { fn } = createDataFetcher('product');
    // Use a short but non-zero TTL so HIT is reliable before expiry
    const getProduct = createCache(fn, { ttl: 1, tags: ['products'] }, handler);

    // MISS: first call executes the function
    const miss = await getProduct();
    expect(miss).toBe('product-1');
    expect(fn).toHaveBeenCalledOnce();

    // HIT: immediate second call returns cached value (well within 1s TTL)
    const hit = await getProduct();
    expect(hit).toBe('product-1');
    expect(fn).toHaveBeenCalledOnce(); // no additional call
    expect(handler.size).toBe(1);

    // STALE: after TTL expires (1s), without SWR the entry is re-fetched
    await new Promise((r) => setTimeout(r, 1050));
    const stale = await getProduct();
    expect(stale).toBe('product-2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('MISS on different args, HIT on repeated args', async () => {
    const fn = vi.fn(async (id: string) => ({ id, ts: Date.now() }));
    const getUser = createCache(fn, { ttl: 60, key: (id: string) => `user:${id}` }, handler);

    // Two different args = two misses
    const user1 = await getUser('alice');
    const user2 = await getUser('bob');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(user1.id).toBe('alice');
    expect(user2.id).toBe('bob');

    // Repeated args = hits
    const user1Again = await getUser('alice');
    const user2Again = await getUser('bob');
    expect(fn).toHaveBeenCalledTimes(2); // no additional calls
    expect(user1Again).toEqual(user1);
    expect(user2Again).toEqual(user2);
  });

  it('STALE entry returns null after tag invalidation (no SWR)', async () => {
    const fn = vi.fn(async () => 'data');
    const getData = createCache(fn, { ttl: 60, tags: ['mydata'] }, handler);

    await getData();
    expect(fn).toHaveBeenCalledOnce();

    // Invalidate via tag
    await handler.invalidate({ tag: 'mydata' });

    // Next call is a MISS — re-executes
    await getData();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('multiple createCache functions share one handler instance', async () => {
    const fn1 = vi.fn(async () => 'products-data');
    const fn2 = vi.fn(async () => 'orders-data');

    const getProducts = createCache(fn1, { ttl: 60, tags: ['shared-tag'] }, handler);
    const getOrders = createCache(fn2, { ttl: 60, tags: ['shared-tag'] }, handler);

    await getProducts();
    await getOrders();
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();

    // Invalidating shared tag clears both
    await handler.invalidate({ tag: 'shared-tag' });

    await getProducts();
    await getOrders();
    expect(fn1).toHaveBeenCalledTimes(2);
    expect(fn2).toHaveBeenCalledTimes(2);
  });
});

// ─── Singleflight concurrent ────────────────────────────────────────────
// Acceptance: Singleflight concurrent

describe('singleflight', () => {
  let handler: MemoryCacheHandler;

  beforeEach(() => {
    handler = new MemoryCacheHandler();
  });

  it('concurrent cache misses coalesce into single execution', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      await tick(30);
      return `result-${callCount}`;
    };
    const cached = createCache(fn, { ttl: 60 }, handler);

    // Fire 5 concurrent requests
    const results = await Promise.all([cached(), cached(), cached(), cached(), cached()]);

    // Only one execution
    expect(callCount).toBe(1);
    // All get the same result
    for (const r of results) {
      expect(r).toBe('result-1');
    }
  });

  it('singleflight works across createCache and registerCachedFunction on same handler', async () => {
    // Both use the same handler but different key strategies.
    // They shouldn't interfere with each other's singleflight.
    let cacheCallCount = 0;
    let registerCallCount = 0;

    const cacheFn = async () => {
      cacheCallCount++;
      await tick(30);
      return `cache-${cacheCallCount}`;
    };

    const registerFn = async () => {
      registerCallCount++;
      await tick(30);
      return `register-${registerCallCount}`;
    };

    const cached = createCache(cacheFn, { ttl: 60 }, handler);
    const registered = registerCachedFunction(
      registerFn,
      {
        ttl: 60,
        id: 'test#Component',
      },
      handler
    );

    // Concurrent calls to both
    const [c1, c2, r1, r2] = await Promise.all([cached(), cached(), registered(), registered()]);

    expect(cacheCallCount).toBe(1);
    expect(registerCallCount).toBe(1);
    expect(c1).toBe(c2);
    expect(r1).toBe(r2);
  });

  it('singleflight does not coalesce different keys', async () => {
    let callCount = 0;
    const fn = async (id: string) => {
      callCount++;
      await tick(20);
      return { id, n: callCount };
    };
    const cached = createCache(fn, { ttl: 60, key: (id: string) => `k:${id}` }, handler);

    const [a, b] = await Promise.all([cached('x'), cached('y')]);
    expect(callCount).toBe(2);
    expect(a.id).toBe('x');
    expect(b.id).toBe('y');
  });
});

// ─── SWR full cycle ─────────────────────────────────────────────────────
// Acceptance: SWR full cycle

describe('swr cycle', () => {
  let handler: MemoryCacheHandler;

  beforeEach(() => {
    handler = new MemoryCacheHandler();
  });

  it('full SWR cycle: fresh → stale-serve → background-refetch → fresh', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return `v${callCount}`;
    };
    const cached = createCache(fn, { ttl: 0, staleWhileRevalidate: true }, handler);

    // 1. Initial call — MISS, executes fn
    const fresh = await cached();
    expect(fresh).toBe('v1');
    expect(callCount).toBe(1);

    // 2. Wait for TTL expiry
    await tick();

    // 3. Stale serve — returns stale value immediately, triggers background refetch
    const staleServed = await cached();
    expect(staleServed).toBe('v1'); // stale value
    expect(callCount).toBe(2); // refetch triggered

    // 4. Wait for background refetch to populate cache
    await tick();

    // 5. Fresh — now gets the refetched value
    const refreshed = await cached();
    expect(refreshed).toBe('v2');
  });

  it('SWR with failed refetch continues serving stale', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount > 1) throw new Error('upstream down');
      return 'original';
    };
    const cached = createCache(fn, { ttl: 0, staleWhileRevalidate: true }, handler);

    const first = await cached();
    expect(first).toBe('original');

    await tick();

    // Stale served, background refetch fails
    const stale1 = await cached();
    expect(stale1).toBe('original');

    await tick();

    // Still serves stale — no crash from failed refetch
    const stale2 = await cached();
    expect(stale2).toBe('original');
  });

  it('SWR singleflight: multiple stale reads trigger only one background refetch', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      await tick(30);
      return `v${callCount}`;
    };
    const cached = createCache(fn, { ttl: 0, staleWhileRevalidate: true }, handler);

    // Populate cache
    await cached();
    expect(callCount).toBe(1);

    await tick();

    // Multiple concurrent stale reads
    const [a, b, c] = await Promise.all([cached(), cached(), cached()]);

    // All serve stale
    expect(a).toBe('v1');
    expect(b).toBe('v1');
    expect(c).toBe('v1');

    // Only one background refetch triggered (singleflight on SWR key)
    expect(callCount).toBe(2);

    // Wait for refetch to complete
    await tick(50);

    // Next read gets fresh value
    const fresh = await cached();
    expect(fresh).toBe('v2');
  });
});

// ─── 'use cache' component uses same handler ────────────────────────────
// Acceptance: 'use cache' component uses same handler

describe('use cache handler', () => {
  let handler: MemoryCacheHandler;

  beforeEach(() => {
    handler = new MemoryCacheHandler();
  });

  it('registerCachedFunction and createCache share the same handler store', async () => {
    // Simulate a 'use cache' component and a timber.cache data function
    // both using the same handler instance.
    const componentFn = vi.fn(async (props: { category: string }) => {
      return `<ProductGrid category="${props.category}" />`;
    });

    const dataFn = vi.fn(async (category: string) => {
      return [{ name: `Product in ${category}` }];
    });

    const CachedComponent = registerCachedFunction(
      componentFn,
      {
        ttl: 60,
        id: 'app/components/ProductGrid#ProductGrid',
        isComponent: true,
        tags: ['products'],
      },
      handler
    );

    const getProducts = createCache(
      dataFn,
      {
        ttl: 60,
        tags: ['products'],
      },
      handler
    );

    // Both populate the same handler
    await CachedComponent({ category: 'shoes' });
    await getProducts('shoes');
    expect(componentFn).toHaveBeenCalledOnce();
    expect(dataFn).toHaveBeenCalledOnce();

    // Both are cached
    await CachedComponent({ category: 'shoes' });
    await getProducts('shoes');
    expect(componentFn).toHaveBeenCalledOnce();
    expect(dataFn).toHaveBeenCalledOnce();

    // Invalidating the shared tag clears BOTH
    await handler.invalidate({ tag: 'products' });

    await CachedComponent({ category: 'shoes' });
    await getProducts('shoes');
    expect(componentFn).toHaveBeenCalledTimes(2);
    expect(dataFn).toHaveBeenCalledTimes(2);
  });

  it('registerCachedFunction stable ID produces consistent keys across calls', async () => {
    const fn = vi.fn(async (props: { id: string }) => `rendered-${props.id}`);
    const Cached = registerCachedFunction(
      fn,
      {
        ttl: 60,
        id: 'app/page#UserCard',
        isComponent: true,
      },
      handler
    );

    // Same props → same key → single execution
    await Cached({ id: '42' });
    await Cached({ id: '42' });
    expect(fn).toHaveBeenCalledOnce();

    // Different props → different key → new execution
    await Cached({ id: '99' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('handler.size reflects entries from both createCache and registerCachedFunction', async () => {
    const dataFn = async () => 'data';
    const componentFn = async () => '<div />';

    const getData = createCache(dataFn, { ttl: 60 }, handler);
    const RenderComponent = registerCachedFunction(
      componentFn,
      {
        ttl: 60,
        id: 'test#Comp',
      },
      handler
    );

    expect(handler.size).toBe(0);

    await getData();
    expect(handler.size).toBe(1);

    await RenderComponent();
    expect(handler.size).toBe(2);
  });
});

// ─── Tag invalidation across both spellings ─────────────────────────────
// Acceptance: Tag invalidation across both spellings

describe('cross invalidation', () => {
  let handler: MemoryCacheHandler;

  beforeEach(() => {
    handler = new MemoryCacheHandler();
  });

  it('handler.invalidate clears entries from both createCache and registerCachedFunction', async () => {
    const dataFn = vi.fn(async () => 'products-list');
    const componentFn = vi.fn(async () => '<ProductGrid />');

    const getProducts = createCache(
      dataFn,
      {
        ttl: 60,
        tags: ['products'],
      },
      handler
    );

    const ProductGrid = registerCachedFunction(
      componentFn,
      {
        ttl: 60,
        id: 'app/components/ProductGrid#ProductGrid',
        tags: ['products'],
      },
      handler
    );

    // Populate both
    await getProducts();
    await ProductGrid();
    expect(dataFn).toHaveBeenCalledOnce();
    expect(componentFn).toHaveBeenCalledOnce();

    // Single tag invalidation clears both
    await handler.invalidate({ tag: 'products' });

    // Both re-execute on next call
    await getProducts();
    await ProductGrid();
    expect(dataFn).toHaveBeenCalledTimes(2);
    expect(componentFn).toHaveBeenCalledTimes(2);
  });

  it('revalidateTag in executeAction invalidates entries from both spellings', async () => {
    const dataFn = vi.fn(async () => 'data-v1');
    const componentFn = vi.fn(async () => '<Comp />');

    const getData = createCache(dataFn, { ttl: 60, tags: ['items'] }, handler);
    const CachedComp = registerCachedFunction(
      componentFn,
      {
        ttl: 60,
        id: 'test#Comp',
        tags: ['items'],
      },
      handler
    );

    // Populate both
    await getData();
    await CachedComp();

    // Execute an action that calls revalidateTag
    const actionFn = async () => {
      revalidateTag('items');
      return 'action-result';
    };

    const result = await executeAction(actionFn, [], { cacheHandler: handler });
    expect(result.actionResult).toBe('action-result');

    // Both entries were invalidated
    await getData();
    await CachedComp();
    expect(dataFn).toHaveBeenCalledTimes(2);
    expect(componentFn).toHaveBeenCalledTimes(2);
  });

  it('per-entity tags: invalidating one entity leaves others cached', async () => {
    const fn = vi.fn(async (id: string) => ({ id, fetched: true }));

    const getUser = createCache(
      fn,
      {
        ttl: 60,
        key: (id: string) => `user:${id}`,
        tags: (id: string) => [`user:${id}`, 'users'],
      },
      handler
    );

    const getUserComponent = registerCachedFunction(
      vi.fn(async (props: { userId: string }) => `<UserCard id="${props.userId}" />`),
      {
        ttl: 60,
        id: 'app#UserCard',
        tags: (props: { userId: string }) => [`user:${props.userId}`],
        isComponent: true,
      },
      handler
    );

    // Populate cache for two users
    await getUser('alice');
    await getUser('bob');
    await getUserComponent({ userId: 'alice' });
    await getUserComponent({ userId: 'bob' });

    // Invalidate alice only
    await handler.invalidate({ tag: 'user:alice' });

    // Alice's entries re-execute
    await getUser('alice');
    expect(fn).toHaveBeenCalledTimes(3); // 2 initial + 1 re-fetch for alice

    // Bob's entries still cached
    await getUser('bob');
    expect(fn).toHaveBeenCalledTimes(3); // no additional call

    // Invalidate all users
    await handler.invalidate({ tag: 'users' });

    // Bob now re-executes (alice was already re-fetched with fresh 'users' tag)
    await getUser('bob');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('tag invalidation in action + path revalidation work together', async () => {
    const dataFn = vi.fn(async () => 'cached-data');
    const getData = createCache(dataFn, { ttl: 60, tags: ['data'] }, handler);

    // Populate cache
    await getData();

    // Mock renderer for revalidatePath
    const renderer = vi.fn(async (_path: string) => ({
      element: { type: 'div', props: { children: 'Revalidated' } },
      headElements: [],
    }));

    // Action that does both tag invalidation and path revalidation
    const { revalidatePath } = await import('../../packages/timber-app/src/server/actions');
    const actionFn = async () => {
      revalidateTag('data');
      revalidatePath('/dashboard');
      return 'ok';
    };

    const result = await executeAction(actionFn, [], {
      cacheHandler: handler,
      renderer,
    });

    expect(result.actionResult).toBe('ok');
    expect(result.revalidation).toBeDefined();
    expect(renderer).toHaveBeenCalledWith('/dashboard');

    // Cache entry was invalidated
    await getData();
    expect(dataFn).toHaveBeenCalledTimes(2);
  });

  it('LRU eviction does not break tag invalidation for remaining entries', async () => {
    // Small cache — only 3 entries
    const smallHandler = new MemoryCacheHandler({ maxSize: 3 });

    const fn = vi.fn(async (id: string) => `item-${id}`);
    const getItem = createCache(
      fn,
      {
        ttl: 60,
        key: (id: string) => `item:${id}`,
        tags: ['items'],
      },
      smallHandler
    );

    // Fill cache: a, b, c
    await getItem('a');
    await getItem('b');
    await getItem('c');
    expect(smallHandler.size).toBe(3);

    // Adding d evicts oldest (a)
    await getItem('d');
    expect(smallHandler.size).toBe(3);

    // b, c, d are still cached
    await getItem('b');
    await getItem('c');
    await getItem('d');
    expect(fn).toHaveBeenCalledTimes(4); // only 4 calls total (a, b, c, d)

    // a was evicted — re-executes
    await getItem('a');
    expect(fn).toHaveBeenCalledTimes(5);

    // Tag invalidation clears all remaining entries
    await smallHandler.invalidate({ tag: 'items' });
    expect(smallHandler.size).toBe(0);
  });
});
