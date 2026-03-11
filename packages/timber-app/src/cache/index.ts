// @timber/app/cache — Caching primitives

export interface CacheHandler {
  get(key: string): Promise<{ value: unknown; stale: boolean } | null>;
  set(key: string, value: unknown, opts: { ttl: number; tags: string[] }): Promise<void>;
  invalidate(opts: { key?: string; tag?: string }): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface CacheOptions<Fn extends (...args: any[]) => any> {
  ttl: number;
  key?: (...args: Parameters<Fn>) => string;
  staleWhileRevalidate?: boolean;
  tags?: string[] | ((...args: Parameters<Fn>) => string[]);
}

export interface MemoryCacheHandlerOptions {
  /** Maximum number of entries. Oldest accessed entries are evicted first. Default: 1000. */
  maxSize?: number;
}

export class MemoryCacheHandler implements CacheHandler {
  private store = new Map<string, { value: unknown; expiresAt: number; tags: string[] }>();
  private maxSize: number;

  constructor(opts?: MemoryCacheHandlerOptions) {
    this.maxSize = opts?.maxSize ?? 1000;
  }

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Move to end of Map (most recently used) for LRU ordering
    this.store.delete(key);
    this.store.set(key, entry);

    const stale = Date.now() > entry.expiresAt;
    return { value: entry.value, stale };
  }

  async set(key: string, value: unknown, opts: { ttl: number; tags: string[] }) {
    // If key already exists, delete first to refresh insertion order
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict oldest entries (front of Map) if at capacity
    while (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      } else {
        break;
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + opts.ttl * 1000,
      tags: opts.tags,
    });
  }

  async invalidate(opts: { key?: string; tag?: string }) {
    if (opts.key) {
      this.store.delete(opts.key);
    }
    if (opts.tag) {
      for (const [key, entry] of this.store) {
        if (entry.tags.includes(opts.tag)) {
          this.store.delete(key);
        }
      }
    }
  }

  /** Number of entries currently in the cache. */
  get size(): number {
    return this.store.size;
  }
}

export { RedisCacheHandler } from './redis-handler';
export type { RedisClient } from './redis-handler';
export { createCache } from './timber-cache';
export { registerCachedFunction } from './register-cached-function';
export type { RegisterCachedFunctionOptions } from './register-cached-function';
export { stableStringify } from './stable-stringify';
export { createSingleflight } from './singleflight';
export type { Singleflight } from './singleflight';
