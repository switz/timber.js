import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryCacheHandler } from '@timber/app/cache'
import { stableStringify } from '../packages/timber-app/src/cache/stable-stringify'
import { createSingleflight } from '../packages/timber-app/src/cache/singleflight'
import { createCache } from '../packages/timber-app/src/cache/timber-cache'

// ---------------------------------------------------------------------------
// stable-stringify
// ---------------------------------------------------------------------------

describe('stableStringify', () => {
  it('sorts object keys deterministically', () => {
    const a = stableStringify({ b: 2, a: 1 })
    const b = stableStringify({ a: 1, b: 2 })
    expect(a).toBe(b)
  })

  it('handles nested objects', () => {
    const a = stableStringify({ z: { b: 2, a: 1 }, a: 1 })
    const b = stableStringify({ a: 1, z: { a: 1, b: 2 } })
    expect(a).toBe(b)
  })

  it('handles arrays (preserves order)', () => {
    const result = stableStringify([3, 1, 2])
    expect(result).toBe('[3,1,2]')
  })

  it('handles null and primitives', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify(42)).toBe('42')
    expect(stableStringify('hello')).toBe('"hello"')
    expect(stableStringify(true)).toBe('true')
  })

  it('handles undefined values in objects (omitted)', () => {
    const result = stableStringify({ a: 1, b: undefined })
    expect(result).toBe('{"a":1}')
  })
})

// ---------------------------------------------------------------------------
// singleflight
// ---------------------------------------------------------------------------

describe('singleflight', () => {
  it('coalesces concurrent calls with the same key', async () => {
    const sf = createSingleflight()
    let callCount = 0
    const work = async () => {
      callCount++
      await new Promise((r) => setTimeout(r, 50))
      return 'result'
    }

    const [a, b, c] = await Promise.all([
      sf.do('key', work),
      sf.do('key', work),
      sf.do('key', work),
    ])

    expect(callCount).toBe(1)
    expect(a).toBe('result')
    expect(b).toBe('result')
    expect(c).toBe('result')
  })

  it('does not coalesce different keys', async () => {
    const sf = createSingleflight()
    let callCount = 0
    const work = async () => {
      callCount++
      return 'result'
    }

    await Promise.all([sf.do('a', work), sf.do('b', work)])
    expect(callCount).toBe(2)
  })

  it('allows new calls after previous completes', async () => {
    const sf = createSingleflight()
    let callCount = 0
    const work = async () => {
      callCount++
      return callCount
    }

    const first = await sf.do('key', work)
    const second = await sf.do('key', work)
    expect(first).toBe(1)
    expect(second).toBe(2)
  })

  it('propagates errors to all waiters', async () => {
    const sf = createSingleflight()
    const work = async () => {
      throw new Error('boom')
    }

    const results = await Promise.allSettled([
      sf.do('key', work),
      sf.do('key', work),
    ])

    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('rejected')
  })
})

// ---------------------------------------------------------------------------
// timber.cache — core
// ---------------------------------------------------------------------------

describe('timber.cache', () => {
  let handler: MemoryCacheHandler

  beforeEach(() => {
    handler = new MemoryCacheHandler()
  })

  it('cache miss executes function', async () => {
    const fn = vi.fn(async (id: string) => ({ id, name: 'test' }))
    const cached = createCache(fn, { ttl: 60 }, handler)

    const result = await cached('abc')
    expect(fn).toHaveBeenCalledOnce()
    expect(result).toEqual({ id: 'abc', name: 'test' })
  })

  it('cache hit returns cached value', async () => {
    const fn = vi.fn(async (id: string) => ({ id, name: 'test' }))
    const cached = createCache(fn, { ttl: 60 }, handler)

    await cached('abc')
    const result = await cached('abc')
    expect(fn).toHaveBeenCalledOnce()
    expect(result).toEqual({ id: 'abc', name: 'test' })
  })

  it('cache with ttl expires entries', async () => {
    const fn = vi.fn(async () => 'value')
    const cached = createCache(fn, { ttl: 0 }, handler)

    await cached()
    // TTL=0 means immediate expiry — next call after any time is stale
    // Without SWR, stale means re-execute
    await new Promise((r) => setTimeout(r, 10))
    await cached()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('tags as string[]', async () => {
    const fn = vi.fn(async () => 'value')
    const cached = createCache(fn, { ttl: 60, tags: ['products'] }, handler)

    await cached()
    expect(fn).toHaveBeenCalledOnce()

    // After invalidating the tag, value should be re-fetched
    await handler.invalidate({ tag: 'products' })
    await cached()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('tags as function of args', async () => {
    const fn = vi.fn(async (id: string) => ({ id }))
    const cached = createCache(
      fn,
      { ttl: 60, tags: (id: string) => [`user:${id}`] },
      handler,
    )

    await cached('abc')
    expect(fn).toHaveBeenCalledOnce()

    // Invalidate the specific tag
    await handler.invalidate({ tag: 'user:abc' })
    await cached('abc')
    expect(fn).toHaveBeenCalledTimes(2)

    // Other entries unaffected
    await cached('def')
    await handler.invalidate({ tag: 'user:abc' })
    await cached('def')
    // 'def' was called once (3rd total), should still be cached
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('custom key function', async () => {
    const fn = vi.fn(async (id: string) => ({ id }))
    const cached = createCache(
      fn,
      { ttl: 60, key: (id: string) => `custom:${id}` },
      handler,
    )

    await cached('abc')
    await cached('abc')
    expect(fn).toHaveBeenCalledOnce()

    // Different key → different execution
    await cached('def')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('sha256 default key', async () => {
    const fn = vi.fn(async (obj: Record<string, number>) => obj)
    const cached = createCache(fn, { ttl: 60 }, handler)

    // Different object key ordering → same cache key
    await cached({ b: 2, a: 1 })
    await cached({ a: 1, b: 2 })
    expect(fn).toHaveBeenCalledOnce()
  })

  it('singleflight: concurrent misses produce single execution', async () => {
    let callCount = 0
    const fn = async (id: string) => {
      callCount++
      await new Promise((r) => setTimeout(r, 50))
      return { id, count: callCount }
    }
    const cached = createCache(fn, { ttl: 60 }, handler)

    const [a, b, c] = await Promise.all([
      cached('abc'),
      cached('abc'),
      cached('abc'),
    ])

    expect(callCount).toBe(1)
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it('swr stale serve: serves stale, background refetch', async () => {
    let callCount = 0
    const fn = async () => {
      callCount++
      return `value-${callCount}`
    }
    const cached = createCache(
      fn,
      { ttl: 0, staleWhileRevalidate: true },
      handler,
    )

    // First call — miss
    const first = await cached()
    expect(first).toBe('value-1')
    expect(callCount).toBe(1)

    // Wait for entry to go stale (ttl=0)
    await new Promise((r) => setTimeout(r, 10))

    // Second call — stale served, background refetch triggers
    const second = await cached()
    expect(second).toBe('value-1') // stale value served
    expect(callCount).toBe(2) // refetch happened

    // Wait for background refetch to complete and populate cache
    await new Promise((r) => setTimeout(r, 10))

    // Third call — fresh value from refetch
    const third = await cached()
    expect(third).toBe('value-2')
  })

  it('swr failed refetch continues stale', async () => {
    let callCount = 0
    const fn = async () => {
      callCount++
      if (callCount > 1) throw new Error('refetch failed')
      return 'original'
    }
    const cached = createCache(
      fn,
      { ttl: 0, staleWhileRevalidate: true },
      handler,
    )

    // First call — miss, succeeds
    const first = await cached()
    expect(first).toBe('original')

    // Wait for stale
    await new Promise((r) => setTimeout(r, 10))

    // Second call — stale served, refetch fails
    const second = await cached()
    expect(second).toBe('original') // stale value still served

    // Wait for failed refetch to finish
    await new Promise((r) => setTimeout(r, 10))

    // Third call — stale value still available
    const third = await cached()
    expect(third).toBe('original')
  })

  it('invalidate by tag', async () => {
    const fn = vi.fn(async () => 'value')
    const cache = createCache(fn, { ttl: 60, tags: ['t1'] }, handler)
    const invalidate = createCache.invalidate.bind(null, handler)

    await cache()
    expect(fn).toHaveBeenCalledOnce()

    await invalidate({ tag: 't1' })
    await cache()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('invalidate by key', async () => {
    const fn = vi.fn(async () => 'value')
    const cached = createCache(
      fn,
      { ttl: 60, key: () => 'my-key' },
      handler,
    )
    const invalidate = createCache.invalidate.bind(null, handler)

    await cached()
    expect(fn).toHaveBeenCalledOnce()

    await invalidate({ key: 'my-key' })
    await cached()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('no als required — works at module scope', async () => {
    // This test verifies timber.cache doesn't depend on AsyncLocalStorage.
    // By running at test scope (no ALS context), we prove it works without one.
    const fn = vi.fn(async () => 'no-als')
    const cached = createCache(fn, { ttl: 60 }, handler)

    const result = await cached()
    expect(result).toBe('no-als')
    expect(fn).toHaveBeenCalledOnce()
  })
})
