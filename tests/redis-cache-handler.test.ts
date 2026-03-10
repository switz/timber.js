import { describe, it, expect, beforeEach } from 'vitest';
import { RedisCacheHandler } from '@timber/app/cache';
import type { RedisClient } from '@timber/app/cache';

/**
 * In-memory mock of a Redis client for testing RedisCacheHandler
 * without a real Redis connection.
 */
function createMockRedisClient(): RedisClient & {
  _store: Map<string, string>;
  _sets: Map<string, Set<string>>;
} {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  return {
    _store: store,
    _sets: sets,

    async get(key: string) {
      return store.get(key) ?? null;
    },

    async set(key: string, value: string, ..._args: unknown[]) {
      store.set(key, value);
      return 'OK';
    },

    async del(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
        if (sets.delete(k)) count++;
      }
      return count;
    },

    async sadd(key: string, ...members: string[]) {
      let set = sets.get(key);
      if (!set) {
        set = new Set();
        sets.set(key, set);
      }
      let added = 0;
      for (const m of members) {
        if (!set.has(m)) {
          set.add(m);
          added++;
        }
      }
      return added;
    },

    async smembers(key: string) {
      const set = sets.get(key);
      return set ? [...set] : [];
    },
  };
}

describe('RedisCacheHandler', () => {
  let client: ReturnType<typeof createMockRedisClient>;
  let handler: RedisCacheHandler;

  beforeEach(() => {
    client = createMockRedisClient();
    handler = new RedisCacheHandler(client);
  });

  describe('redis operations', () => {
    it('returns null for missing keys', async () => {
      expect(await handler.get('nonexistent')).toBeNull();
    });

    it('stores and retrieves values', async () => {
      await handler.set('user:1', { name: 'Alice' }, { ttl: 60, tags: ['users'] });
      const result = await handler.get('user:1');
      expect(result).not.toBeNull();
      expect(result!.value).toEqual({ name: 'Alice' });
      expect(result!.stale).toBe(false);
    });

    it('marks entries as stale after TTL expires', async () => {
      // Set with a very short TTL — we'll manually adjust the stored expiresAt
      await handler.set('key', 'value', { ttl: 1, tags: [] });

      // Tamper with the stored value to simulate time passing
      const rawKey = 'timber:cache:key';
      const raw = JSON.parse(client._store.get(rawKey)!);
      raw.expiresAt = Date.now() - 1000; // expired 1s ago
      client._store.set(rawKey, JSON.stringify(raw));

      const result = await handler.get('key');
      expect(result).not.toBeNull();
      expect(result!.stale).toBe(true);
    });

    it('invalidates by key', async () => {
      await handler.set('key', 'value', { ttl: 60, tags: [] });
      await handler.invalidate({ key: 'key' });
      expect(await handler.get('key')).toBeNull();
    });

    it('invalidates by tag', async () => {
      await handler.set('a', 'val-a', { ttl: 60, tags: ['t1'] });
      await handler.set('b', 'val-b', { ttl: 60, tags: ['t1', 't2'] });
      await handler.set('c', 'val-c', { ttl: 60, tags: ['t2'] });

      await handler.invalidate({ tag: 't1' });

      expect(await handler.get('a')).toBeNull();
      expect(await handler.get('b')).toBeNull();
      expect(await handler.get('c')).not.toBeNull();
    });

    it('cleans up tag set after invalidation', async () => {
      await handler.set('a', 1, { ttl: 60, tags: ['cleanup'] });
      await handler.invalidate({ tag: 'cleanup' });

      // The tag set should be deleted
      expect(client._sets.has('timber:tag:cleanup')).toBe(false);
    });

    it('handles invalidation of empty tag set gracefully', async () => {
      // Should not throw
      await handler.invalidate({ tag: 'nonexistent-tag' });
    });

    it('handles invalidation with both key and tag', async () => {
      await handler.set('x', 1, { ttl: 60, tags: ['t'] });
      await handler.set('y', 2, { ttl: 60, tags: ['t'] });
      await handler.set('z', 3, { ttl: 60, tags: [] });

      await handler.invalidate({ key: 'z', tag: 't' });

      expect(await handler.get('x')).toBeNull();
      expect(await handler.get('y')).toBeNull();
      expect(await handler.get('z')).toBeNull();
    });

    it('stores complex nested values', async () => {
      const value = {
        user: { id: 1, name: 'Alice' },
        items: [1, 2, 3],
        nested: { deep: { value: true } },
      };
      await handler.set('complex', value, { ttl: 60, tags: [] });
      const result = await handler.get('complex');
      expect(result!.value).toEqual(value);
    });

    it('supports custom key prefix', async () => {
      const prefixed = new RedisCacheHandler(client, { prefix: 'myapp:' });
      await prefixed.set('key', 'value', { ttl: 60, tags: ['t1'] });

      // Should be stored with the custom prefix
      expect(client._store.has('myapp:timber:cache:key')).toBe(true);

      const result = await prefixed.get('key');
      expect(result!.value).toBe('value');
    });

    it('different prefixes are isolated', async () => {
      const handler1 = new RedisCacheHandler(client, { prefix: 'app1:' });
      const handler2 = new RedisCacheHandler(client, { prefix: 'app2:' });

      await handler1.set('key', 'from-app1', { ttl: 60, tags: [] });
      await handler2.set('key', 'from-app2', { ttl: 60, tags: [] });

      expect((await handler1.get('key'))!.value).toBe('from-app1');
      expect((await handler2.get('key'))!.value).toBe('from-app2');
    });
  });
});
