# Caching

## `timber.cache` — The Caching Primitive

`timber.cache` is the primary caching API. It replaces the Next.js data cache entirely — no patched `fetch`, no `unstable_cache`, no implicit caching. If you wrap a function with `timber.cache`, it's cached. If you don't, it's not.

```typescript
import { cache } from '@timber/app/cache'

export const getPopularProducts = cache(
  async () => {
    return db.products.findPopular()
  },
  { ttl: 300, tags: () => ['products'] }
)
```

### What it replaces

| Next.js concept | `timber.cache` equivalent |
|---|---|
| `fetch(..., { next: { revalidate: 60 } })` | `timber.cache(fn, { ttl: 60 })` |
| `unstable_cache(fn, ['key'], { tags: ['x'] })` | `timber.cache(fn, { tags: () => ['x'] })` |
| `revalidateTag('x')` | `timber.cache.invalidate({ tag: 'x' })` |
| `revalidatePath('/foo')` | `timber.cache.invalidate({ tag: 'path:/foo' })` |
| ISR data cache on disk | Cache handler (pluggable) |
| Patched `fetch` with implicit caching | Plain `fetch`, no patching |

### API

```typescript
const getUser = timber.cache(
  async (userId: string) => {
    return await db.users.findUnique({ where: { id: userId } })
  },
  {
    ttl: 60,                                     // seconds
    key: (userId) => `user:${userId}`,           // explicit key (optional — default: fn identity + serialized args)
    staleWhileRevalidate: true,                  // serve stale while refetching in background
    tags: (userId) => [`user:${userId}`],        // function form: receives same args as the wrapped function
    // tags: ['users'],                          // static array form also accepted
  }
)
```

### `tags` Type

`tags` accepts either a static array or a function:

```typescript
type Tags<Fn extends (...args: any[]) => any> =
  | string[]
  | ((...args: Parameters<Fn>) => string[])
```

- **Static array** — use when the tags don't depend on the function's arguments:
  ```typescript
  timber.cache(fn, { tags: ['products'] })
  ```
- **Function form** — receives the same arguments as the wrapped function. Use for per-entity tags:
  ```typescript
  timber.cache(fn, { tags: (userId) => [`user:${userId}`] })
  ```

The function form is called at cache-set time with the original arguments — not at invalidation time. Both forms produce an array of strings stored alongside the cached entry for tag-based invalidation.

### Singleflight (Request Coalescing)

When multiple concurrent requests trigger a cache miss for the same key, `timber.cache` coalesces them into a single execution. Only one request runs the underlying function; all others wait for and share the result. This prevents thundering herd problems on cache expiry for high-traffic routes.

Singleflight is built into `timber.cache` — no opt-in required. The coalescing is per-process (in-memory). For multi-instance deployments, each instance coalesces independently. Combined with `staleWhileRevalidate`, this means at most one request per instance per key executes the underlying function during a revalidation window.

### Cache Key Security

The default key — `fn identity + serialized args` — uses deterministic JSON serialization and a cryptographic hash (SHA-256). Object key ordering is normalized before hashing, so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce the same key. Cryptographic hashing eliminates collision-based cache poisoning attacks.

For security-sensitive cache entries (user data, session-derived content), an explicit `key:` function is recommended — it makes the cache key contract visible and auditable.

### Relationship to `React.cache`

`timber.cache` and `React.cache` are separate APIs with separate concerns. They do not wrap each other.

- **`React.cache`** — per-request deduplication within the render pass. Built into React. Use it for functions that should deduplicate within a request but don't need cross-request caching. Import from `'react'`.
- **`timber.cache`** — cross-request caching with TTL/tags. The cacheHandler stores data across requests. Calling the same `timber.cache`-wrapped function twice with the same arguments hits the cacheHandler on both calls — deduplication is inherent in the cache lookup, no `React.cache` wrapper needed.

```
Request 1: getUser("abc")
  -> timber.cache cacheHandler: MISS -> DB query -> stored with TTL
  Same request, another component calls getUser("abc")
  -> timber.cache cacheHandler: HIT -> returns cached value (no extra memory)

Request 2 (10s later): getUser("abc")
  -> timber.cache cacheHandler: HIT (TTL not expired) -> no DB query

Request 3 (70s later): getUser("abc")
  -> timber.cache cacheHandler: MISS (TTL expired) -> DB query -> stored
```

**When to use which:**

| Need | Use |
|---|---|
| Per-request dedup, no persistence | `React.cache` (from `'react'`) |
| Cross-request caching with TTL/tags | `timber.cache` |
| Both dedup and persistence | `timber.cache` (cacheHandler provides inherent dedup) |

**Important context differences:** `React.cache` is only active inside `renderToReadableStream`. It is NOT available in `middleware.ts` or API route handlers (`route.ts`). Auth functions that need to work across all contexts (page routes, API routes, middleware.ts) should use `timber.cache`, not `React.cache`.

**middleware.ts note:** Middleware runs before `renderToReadableStream`, so `React.cache` is not active. Fire-and-forget prefetches from middleware use `timber.cache` — they populate the cacheHandler directly. When the render pass starts, components calling the same `timber.cache`-wrapped functions hit the warm cacheHandler.

### `staleWhileRevalidate`

When `staleWhileRevalidate: true`, an expired cache entry is served immediately while a background refetch runs. The next request after the refetch completes gets fresh data.

```typescript
timber.cache(fn, { ttl: 60, staleWhileRevalidate: true })
```

The behavior:
- **0-60s:** Fresh. Served from cache.
- **60s+:** Stale. Served from cache immediately. Background refetch starts. The refetch result replaces the stale entry.
- **If refetch fails:** Stale entry continues to be served. Error is logged.

There is no separate time window for stale serving — once an entry is stale, it remains servable until the refetch succeeds or the entry is explicitly invalidated.

### Invalidation

Three modes:

```typescript
// 1. TTL-based (passive) — cache expires after TTL
timber.cache(fn, { ttl: 60 })

// 2. Tag-based (active) — invalidate by tag after mutations
async function updateUserRole(userId: string, newRole: string) {
  await db.users.update(...)
  timber.cache.invalidate({ tag: `user:${userId}` })
}

// 3. Key-based (direct) — surgical invalidation
timber.cache.invalidate({ key: 'user:abc' })
```

### `revalidatePath` vs `revalidateTag`

These are distinct functions with different purposes:

- **`revalidatePath(path)`** — re-runs the handler and re-renders the route at that path. Returns the RSC flight payload for inline reconciliation. Used after mutations to refresh the current page without a navigation. Does NOT invalidate cached data in `timber.cache` or `"use cache"` entries.
- **`revalidateTag(tag)`** — invalidates all `timber.cache` entries and `"use cache"` entries tagged with that tag. Does not return a payload — the next request for data using those tags re-executes the underlying function.

To invalidate cached data AND refresh the current page, call both:

```typescript
'use server'
export async function updateProduct(id: string, data: ProductUpdate) {
  await db.products.update(id, data)
  timber.cache.invalidate({ tag: `product:${id}` })  // purge cached data
  return revalidatePath(`/products/${id}`)             // refresh current page
}
```

### Cache Handler (Pluggable Storage)

The cache handler is the deployment adapter for data caching. The framework doesn't care where data lives.

```typescript
interface CacheHandler {
  get(key: string): Promise<{ value: unknown, stale: boolean } | null>
  set(key: string, value: unknown, opts: { ttl: number, tags: string[] }): Promise<void>
  invalidate(opts: { key?: string, tag?: string }): Promise<void>
}
```

```typescript
// timber.config.ts
import { MemoryCacheHandler, RedisCacheHandler } from '@timber/app/cache'

export default {
  cacheHandler: process.env.REDIS_URL
    ? new RedisCacheHandler(process.env.REDIS_URL)
    : new MemoryCacheHandler()  // default: in-process LRU
}
```

**Distributed invalidation** is the cache handler's responsibility. `revalidateTag(tag)` calls `invalidate({ tag })` on the configured cache handler. Whether that invalidation propagates across multiple server instances depends entirely on the handler:

- **`MemoryCacheHandler`** (default) — in-process LRU with configurable `maxSize` (default: 1000 entries). Oldest-accessed entries are evicted when the cache is full. Each server instance has its own isolated cache. Invalidation on one instance does not affect others. `revalidateTag` only clears the current instance's cache. Acceptable for single-instance deployments; use a shared handler for multi-instance.
- **`RedisCacheHandler`** — shared cache. Accepts any Redis client implementing the `RedisClient` interface (ioredis, node-redis, @upstash/redis). All instances call the same Redis; `invalidate()` removes the entry from the shared store. Tag-based invalidation uses Redis Sets to track key→tag membership. All instances see the invalidation on their next cache lookup. Redis pub/sub can be layered on top for push notification, but the cache handler itself guarantees correctness via the shared store.
- **Cloudflare KV** — eventually consistent. KV writes propagate to all edge nodes within seconds. Invalidation is not instant globally, but is consistent within the eventual-consistency window. Acceptable for most use cases.

The framework does not provide a built-in cross-instance broadcast mechanism. Correctness is guaranteed by using a shared cache handler. Choose the handler that matches your deployment topology.

### `fetch` is just `fetch`

No patching, no magic caching, no `{ next: { revalidate } }` options. If you want caching, wrap the function:

```typescript
const getProducts = timber.cache(
  async (category: string) => {
    const res = await fetch(`https://api.example.com/products?cat=${category}`)
    return res.json()
  },
  { ttl: 300, tags: (cat) => [`products`, `products:${cat}`] }
)
```

---

## `"use cache"` — Component-Level Caching

`"use cache"` caches rendered RSC output for components. This is valid in an SSR-first model — a component whose output doesn't change per-user can be cached and reused across requests.

```typescript
async function PopularProducts() {
  'use cache'
  cacheLife('1h')
  const products = await db.products.findPopular()
  return <ProductGrid products={products} />
}
```

**Cache key for components:** Props are the cache key. Same props = same cached output. The cached output is invalidated when `cacheLife` expires or `revalidateTag(tag)` is called with a matching tag. Dev-mode warning is emitted when props appear request-specific (contain values derived from `cookies()`, `headers()`, or user identity) — passing user-specific data as props to a cached component would serve one user's render to another.

**Security note:** The dev-mode warning for request-specific props is not optional guidance — it flags a real data leakage risk. A `"use cache"` component whose props include a user ID will serve one user's rendered output to another. If the cache handler is a shared store (Redis, Cloudflare KV), the deployer is responsible for access control on the store itself — the framework does not authenticate cache handler connections.

`"use cache"` and `timber.cache` are two spellings of the same caching system — same cache handler, same TTL/tags, same invalidation via `revalidateTag(tag)`. The difference is what they cache: `timber.cache` wraps data functions (caches return values); `"use cache"` annotates components (caches rendered RSC payloads). Use `timber.cache()` for shared data functions. Use `"use cache"` when the rendering itself is expensive and the output is shareable across requests.

---

## Output Modes

The project-wide output mode is set in `timber.config.ts`. One decision: does this app have a server?

```ts
// timber.config.ts
export default {
  output: 'server' // default
}

// static site with React hydration
export default {
  output: 'static'
}

// static site, zero JavaScript
export default {
  output: 'static',
  static: { noJS: true }
}
```

- **`server`** (default) — every request renders fresh. `<Suspense>` streams after the status commits. `middleware.ts` and `access.ts` run per-request.
- **`static`** — fully built at build time. No server. No `route.ts` API endpoints. `middleware.ts` files run at build time only. `<Suspense>` is client-initiated only. React client runtime is included for hydration and SPA navigation. Server actions are deployed as separate API endpoints via the adapter (see [Forms & Server Actions](08-forms-and-actions.md#server-actions-in-static-mode)). Set `static: { noJS: true }` for zero JavaScript output — no React runtime, no SPA navigation, pure `<a>` tags. `'use client'` is a hard build error in `noJS` mode. `'use server'` is a build error in `noJS` mode.

### `access.ts` in Static Mode

In `static` mode, `access.ts` runs at build time only. Auth that reads `cookies()` or `headers()` in static mode produces a build error.

### No ISR

timber.js is SSR-first by default. Every request triggers a fresh render unless `"use cache"` or `timber.cache` is used. There is no ISR.

CDN caching is the developer's responsibility, set explicitly via `Cache-Control` headers in `middleware.ts` or `proxy.ts`. The framework does not derive cache headers automatically.

### Future: Static Shell Optimization

An opt-in optimization within `server` mode — cached shells with per-request dynamic holes (`'use dynamic'`). Designed but deferred to a later phase. See [Future: Pre-Rendering](15-future-prerendering.md) for the full design.

---

## Implementation Architecture

### File Decomposition

The caching system is split across three files with distinct responsibilities:

| File | Responsibility |
|------|---------------|
| `cache-handler.ts` | `CacheHandler` interface + `MemoryCacheHandler` default implementation |
| `cache-runtime.ts` | `"use cache"` transform runtime: `registerCachedFunction()`, RSC payload serialization, cache key generation |
| `cache.ts` | Public API: `timber.cache()` wrapper, `timber.cache.invalidate()`, exports for `@timber/app/cache` |

`cache-handler.ts` is a standalone module with no framework dependencies — it can be tested in isolation. `cache-runtime.ts` depends on the RSC environment (it serializes React element trees). `cache.ts` ties them together and provides the developer-facing API.

### `"use cache"` Transform Architecture

The Vite plugin transforms `"use cache"` directives into `registerCachedFunction()` calls. The transform runs in the RSC environment only — client components cannot use `"use cache"`.

Before transform:
```tsx
async function PopularProducts() {
  'use cache'
  cacheLife('1h')
  const products = await db.products.findPopular()
  return <ProductGrid products={products} />
}
```

After transform:
```tsx
const PopularProducts = registerCachedFunction(
  async function PopularProducts() {
    const products = await db.products.findPopular()
    return <ProductGrid products={products} />
  },
  { ttl: 3600, id: 'app/components/PopularProducts#PopularProducts' }
)
```

The transform:
1. Detects the `'use cache'` directive in the function body
2. Extracts `cacheLife()` calls and converts to TTL options
3. Wraps the function in `registerCachedFunction()` with a stable ID derived from file path + function name
4. The stable ID ensures cache keys are consistent across builds

### Cache Key Generation

Both `timber.cache` and `"use cache"` use the same key generation:

1. **Function identity** — stable ID (file path + export name for `"use cache"`, or explicit `key` option for `timber.cache`)
2. **Arguments/props** — deterministic JSON serialization with sorted object keys (`stableStringify`)
3. **Hash** — SHA-256 of `identity + serialized args` → hex string cache key

Keys are never user-visible. The cryptographic hash prevents collision-based cache poisoning and keeps key length constant regardless of argument complexity.

### Singleflight Implementation

Singleflight is an in-memory `Map<string, Promise>` keyed by cache key. Per-process, not distributed:

```
Request A: cache.get("key") → MISS → starts execution, stores Promise in singleflight map
Request B: cache.get("key") → MISS → finds Promise in singleflight map → waits on same Promise
Request A: execution completes → result stored in cache handler → Promise resolves → singleflight entry removed
Request B: receives same result from shared Promise
```

Combined with `staleWhileRevalidate`: at most one execution per instance per key during a revalidation window. The stale value is served immediately while the single background execution runs.

### What We Keep From vinext's `cache-runtime.ts`

Per the audit in `audit-cache-runtime.md`:

**Keep:**
- RSC payload serialization for `"use cache"` (React Flight format)
- SHA-256 key generation with `stableStringify`
- The `registerCachedFunction` pattern

**Discard:**
- ISR integration (no ISR in timber.js)
- `cacheLife` minimum-wins semantics (timber.js uses last-wins — the component's `cacheLife()` is authoritative)
- `noStore()` / dynamic opt-out (timber.js has no implicit caching to opt out of)
- Fetch patching integration
