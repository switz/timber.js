import { describe, it, expect } from 'vitest';
import { MemoryCacheHandler, createCache } from '@timber/app/cache';
import type { CacheHandler } from '@timber/app/cache';

describe('MemoryCacheHandler', () => {
  it('returns null for missing keys', async () => {
    const handler = new MemoryCacheHandler();
    const result = await handler.get('nonexistent');
    expect(result).toBeNull();
  });

  it('stores and retrieves values', async () => {
    const handler = new MemoryCacheHandler();
    await handler.set('key', { data: 'hello' }, { ttl: 60, tags: [] });
    const result = await handler.get('key');
    expect(result).not.toBeNull();
    expect(result!.value).toEqual({ data: 'hello' });
    expect(result!.stale).toBe(false);
  });

  it('invalidates by key', async () => {
    const handler = new MemoryCacheHandler();
    await handler.set('key', 'value', { ttl: 60, tags: [] });
    await handler.invalidate({ key: 'key' });
    const result = await handler.get('key');
    expect(result).toBeNull();
  });

  it('invalidates by tag', async () => {
    const handler = new MemoryCacheHandler();
    await handler.set('a', 'val-a', { ttl: 60, tags: ['t1'] });
    await handler.set('b', 'val-b', { ttl: 60, tags: ['t1', 't2'] });
    await handler.set('c', 'val-c', { ttl: 60, tags: ['t2'] });

    await handler.invalidate({ tag: 't1' });

    expect(await handler.get('a')).toBeNull();
    expect(await handler.get('b')).toBeNull();
    expect(await handler.get('c')).not.toBeNull();
  });

  describe('lru eviction', () => {
    it('evicts oldest entry when maxSize is reached', async () => {
      const handler = new MemoryCacheHandler({ maxSize: 3 });
      await handler.set('a', 1, { ttl: 60, tags: [] });
      await handler.set('b', 2, { ttl: 60, tags: [] });
      await handler.set('c', 3, { ttl: 60, tags: [] });

      // Cache is full — adding 'd' should evict 'a' (oldest)
      await handler.set('d', 4, { ttl: 60, tags: [] });

      expect(await handler.get('a')).toBeNull();
      expect(await handler.get('b')).not.toBeNull();
      expect(await handler.get('c')).not.toBeNull();
      expect(await handler.get('d')).not.toBeNull();
      expect(handler.size).toBe(3);
    });

    it('accessing an entry makes it most recently used', async () => {
      const handler = new MemoryCacheHandler({ maxSize: 3 });
      await handler.set('a', 1, { ttl: 60, tags: [] });
      await handler.set('b', 2, { ttl: 60, tags: [] });
      await handler.set('c', 3, { ttl: 60, tags: [] });

      // Access 'a' to make it most recently used
      await handler.get('a');

      // Adding 'd' should evict 'b' (now the oldest accessed)
      await handler.set('d', 4, { ttl: 60, tags: [] });

      expect(await handler.get('a')).not.toBeNull();
      expect(await handler.get('b')).toBeNull();
      expect(await handler.get('c')).not.toBeNull();
      expect(await handler.get('d')).not.toBeNull();
    });

    it('updating an existing entry refreshes its position', async () => {
      const handler = new MemoryCacheHandler({ maxSize: 3 });
      await handler.set('a', 1, { ttl: 60, tags: [] });
      await handler.set('b', 2, { ttl: 60, tags: [] });
      await handler.set('c', 3, { ttl: 60, tags: [] });

      // Update 'a' — this refreshes its position
      await handler.set('a', 10, { ttl: 60, tags: [] });

      // Adding 'd' should evict 'b' (oldest)
      await handler.set('d', 4, { ttl: 60, tags: [] });

      const a = await handler.get('a');
      expect(a).not.toBeNull();
      expect(a!.value).toBe(10);
      expect(await handler.get('b')).toBeNull();
    });

    it('defaults to maxSize of 1000', async () => {
      const handler = new MemoryCacheHandler();
      for (let i = 0; i < 1000; i++) {
        await handler.set(`k${i}`, i, { ttl: 60, tags: [] });
      }
      expect(handler.size).toBe(1000);

      // Adding one more should evict the first
      await handler.set('overflow', 'x', { ttl: 60, tags: [] });
      expect(handler.size).toBe(1000);
      expect(await handler.get('k0')).toBeNull();
    });

    it('exposes current size', async () => {
      const handler = new MemoryCacheHandler({ maxSize: 5 });
      expect(handler.size).toBe(0);
      await handler.set('a', 1, { ttl: 60, tags: [] });
      expect(handler.size).toBe(1);
    });
  });
});

describe('pluggable config', () => {
  it('createCache accepts any CacheHandler implementation', async () => {
    // A minimal custom handler that satisfies the CacheHandler interface
    const store = new Map<string, { value: unknown; stale: boolean }>();
    const customHandler: CacheHandler = {
      async get(key) {
        return store.get(key) ?? null;
      },
      async set(key, value) {
        store.set(key, { value, stale: false });
      },
      async invalidate(opts) {
        if (opts.key) store.delete(opts.key);
      },
    };

    let calls = 0;
    const cachedFn = createCache(
      async (x: number) => {
        calls++;
        return x * 2;
      },
      { ttl: 60 },
      customHandler
    );

    const r1 = await cachedFn(5);
    expect(r1).toBe(10);
    expect(calls).toBe(1);

    // Second call should hit the custom handler's cache
    const r2 = await cachedFn(5);
    expect(r2).toBe(10);
    expect(calls).toBe(1);
  });

  it('MemoryCacheHandler can be used as CacheHandler', async () => {
    const handler: CacheHandler = new MemoryCacheHandler({ maxSize: 100 });
    const cachedFn = createCache(
      async (name: string) => `hello ${name}`,
      { ttl: 60, tags: ['greetings'] },
      handler
    );

    expect(await cachedFn('world')).toBe('hello world');
    // Invalidation works through the interface
    await handler.invalidate({ tag: 'greetings' });
  });
});
