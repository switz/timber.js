import { createHash } from 'node:crypto'
import type { CacheHandler, CacheOptions } from './index'
import { stableStringify } from './stable-stringify'
import { createSingleflight } from './singleflight'

const singleflight = createSingleflight()

/**
 * Generate a SHA-256 cache key from function identity and serialized args.
 */
function defaultKeyGenerator(fnId: string, args: unknown[]): string {
  const raw = fnId + ':' + stableStringify(args)
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Resolve tags from the options — supports static array or function form.
 */
function resolveTags<Fn extends (...args: any[]) => any>(
  opts: CacheOptions<Fn>,
  args: Parameters<Fn>,
): string[] {
  if (!opts.tags) return []
  if (Array.isArray(opts.tags)) return opts.tags
  return opts.tags(...args)
}

// Counter for generating unique function IDs when no explicit key is provided.
let fnIdCounter = 0

/**
 * Creates a cached wrapper around an async function.
 *
 * - SHA-256 default keys with normalized JSON args
 * - Singleflight: concurrent misses → single execution
 * - SWR: serve stale immediately, background refetch
 * - Tags as string[] or function of args
 * - No ALS dependency
 */
export function createCache<Fn extends (...args: any[]) => Promise<any>>(
  fn: Fn,
  opts: CacheOptions<Fn>,
  handler: CacheHandler,
): (...args: Parameters<Fn>) => Promise<Awaited<ReturnType<Fn>>> {
  const fnId = `timber-cache:${fnIdCounter++}`

  return async (...args: Parameters<Fn>): Promise<Awaited<ReturnType<Fn>>> => {
    const key = opts.key
      ? opts.key(...args)
      : defaultKeyGenerator(fnId, args)

    const cached = await handler.get(key)

    if (cached && !cached.stale) {
      return cached.value as Awaited<ReturnType<Fn>>
    }

    if (cached && cached.stale && opts.staleWhileRevalidate) {
      // Serve stale immediately, trigger background refetch
      singleflight
        .do(`swr:${key}`, async () => {
          try {
            const fresh = await fn(...args)
            const tags = resolveTags(opts, args)
            await handler.set(key, fresh, { ttl: opts.ttl, tags })
          } catch {
            // Failed refetch — stale entry continues to be served.
            // Error is swallowed per design doc: "Error is logged."
          }
        })
        .catch(() => {
          // Singleflight promise rejection handled — stale continues.
        })
      return cached.value as Awaited<ReturnType<Fn>>
    }

    // Cache miss (or stale without SWR) — execute with singleflight
    const result = await singleflight.do(key, () => fn(...args))
    const tags = resolveTags(opts, args)
    await handler.set(key, result, { ttl: opts.ttl, tags })
    return result as Awaited<ReturnType<Fn>>
  }
}

/**
 * Invalidate cache entries by tag or key.
 */
createCache.invalidate = async function invalidate(
  handler: CacheHandler,
  opts: { key?: string; tag?: string },
): Promise<void> {
  await handler.invalidate(opts)
}
