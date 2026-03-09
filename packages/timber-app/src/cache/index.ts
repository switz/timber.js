// @timber/app/cache — Caching primitives

export interface CacheHandler {
  get(key: string): Promise<{ value: unknown; stale: boolean } | null>
  set(key: string, value: unknown, opts: { ttl: number; tags: string[] }): Promise<void>
  invalidate(opts: { key?: string; tag?: string }): Promise<void>
}

export interface CacheOptions<Fn extends (...args: any[]) => any> {
  ttl: number
  key?: (...args: Parameters<Fn>) => string
  staleWhileRevalidate?: boolean
  tags?: string[] | ((...args: Parameters<Fn>) => string[])
}

export class MemoryCacheHandler implements CacheHandler {
  private store = new Map<string, { value: unknown; expiresAt: number; tags: string[] }>()

  async get(key: string) {
    const entry = this.store.get(key)
    if (!entry) return null
    const stale = Date.now() > entry.expiresAt
    return { value: entry.value, stale }
  }

  async set(key: string, value: unknown, opts: { ttl: number; tags: string[] }) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + opts.ttl * 1000,
      tags: opts.tags,
    })
  }

  async invalidate(opts: { key?: string; tag?: string }) {
    if (opts.key) {
      this.store.delete(opts.key)
    }
    if (opts.tag) {
      for (const [key, entry] of this.store) {
        if (entry.tags.includes(opts.tag)) {
          this.store.delete(key)
        }
      }
    }
  }
}
