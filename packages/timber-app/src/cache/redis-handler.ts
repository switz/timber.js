import type { CacheHandler } from './index';

/**
 * Minimal Redis client interface — compatible with ioredis, node-redis, and
 * Cloudflare Workers Redis bindings. We depend on the interface, not the
 * implementation, so users bring their own Redis client.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
}

const KEY_PREFIX = 'timber:cache:';
const TAG_PREFIX = 'timber:tag:';

/**
 * Redis-backed CacheHandler for distributed caching.
 *
 * All instances sharing the same Redis see each other's cache entries and
 * invalidations. Tag-based invalidation uses Redis Sets to track which keys
 * belong to which tags.
 *
 * Bring your own Redis client — any client implementing the RedisClient
 * interface works (ioredis, node-redis, @upstash/redis, etc.).
 */
export class RedisCacheHandler implements CacheHandler {
  private client: RedisClient;
  private prefix: string;

  constructor(client: RedisClient, opts?: { prefix?: string }) {
    this.client = client;
    this.prefix = opts?.prefix ?? '';
  }

  private cacheKey(key: string): string {
    return `${this.prefix}${KEY_PREFIX}${key}`;
  }

  private tagKey(tag: string): string {
    return `${this.prefix}${TAG_PREFIX}${tag}`;
  }

  async get(key: string): Promise<{ value: unknown; stale: boolean } | null> {
    const raw = await this.client.get(this.cacheKey(key));
    if (raw === null) return null;

    const entry = JSON.parse(raw) as { value: unknown; expiresAt: number };
    const stale = Date.now() > entry.expiresAt;
    return { value: entry.value, stale };
  }

  async set(key: string, value: unknown, opts: { ttl: number; tags: string[] }): Promise<void> {
    const ck = this.cacheKey(key);
    const expiresAt = Date.now() + opts.ttl * 1000;
    const payload = JSON.stringify({ value, expiresAt });

    // Redis TTL with generous margin beyond the logical TTL to allow SWR reads
    // on stale entries. The logical staleness is determined by expiresAt.
    // We use 2x TTL + 60s as the Redis expiry so stale entries remain
    // available for SWR background refetches.
    const redisTtlSeconds = Math.max(opts.ttl * 2 + 60, 120);
    await this.client.set(ck, payload, 'EX', redisTtlSeconds);

    // Track key membership in each tag set
    for (const tag of opts.tags) {
      await this.client.sadd(this.tagKey(tag), key);
    }
  }

  async invalidate(opts: { key?: string; tag?: string }): Promise<void> {
    if (opts.key) {
      await this.client.del(this.cacheKey(opts.key));
    }

    if (opts.tag) {
      const tk = this.tagKey(opts.tag);
      const keys = await this.client.smembers(tk);

      if (keys.length > 0) {
        const cacheKeys = keys.map((k) => this.cacheKey(k));
        await this.client.del(cacheKeys);
      }

      // Clean up the tag set itself
      await this.client.del(tk);
    }
  }
}
