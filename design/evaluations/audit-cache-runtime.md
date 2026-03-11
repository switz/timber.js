# Audit: Cache Runtime System

> **Historical document.** This audited Vinext's cache runtime to understand the design space before
> timber.js implemented its own cache system from scratch. Vinext code paths referenced here do not
> exist in timber.js — they informed our independent implementation.

**Task:** timber-b5n.3
**Date:** 2026-03-09
**Vinext files analyzed (for reference only):**
- `packages/vinext/src/shims/cache-runtime.ts`
- `packages/vinext/src/shims/cache.ts`
- `packages/vinext/src/server/isr-cache.ts`
- `packages/vinext/src/cloudflare/kv-cache-handler.ts`
- `packages/vinext/src/shims/fetch-cache.ts`

---

## Architecture Overview

The cache system has four layers:

```
┌─────────────────────────────────────────────────┐
│ Public API                                       │
│ cache.ts: revalidateTag, revalidatePath,         │
│           unstable_cache, cacheLife, cacheTag     │
├─────────────────────────────────────────────────┤
│ "use cache" Runtime                              │
│ cache-runtime.ts: registerCachedFunction          │
│ RSC serialization, key generation, ALS context   │
├─────────────────────────────────────────────────┤
│ ISR Layer                                        │
│ isr-cache.ts: isrGet, isrSet,                    │
│ triggerBackgroundRegeneration, revalidate tracking│
├─────────────────────────────────────────────────┤
│ CacheHandler Interface                           │
│ MemoryCacheHandler (default)                     │
│ KVCacheHandler (Cloudflare)                      │
└─────────────────────────────────────────────────┘
```

---

## File-by-File Analysis

### 1. `shims/cache-runtime.ts` — "use cache" Runtime

**What it does:**
- Provides `registerCachedFunction()` — the core runtime called by the Vite transform for `"use cache"` directives
- Manages `CacheContext` via AsyncLocalStorage (tags + lifeConfigs collected during execution)
- Generates cache keys using RSC `encodeReply` (with SHA-256 for FormData) or `stableStringify` fallback
- Handles three cache variants: default/remote (shared via CacheHandler), private (per-request Map)
- Serializes/deserializes cached values via RSC stream (base64-encoded) with JSON fallback
- Unwraps Next.js 16 thenable params objects for correct cache key generation
- Skips shared cache in dev mode for HMR compatibility

**Exports:**

| Export | Used? | Purpose |
|--------|-------|---------|
| `CacheContext` (interface) | Yes | Type for cache execution context |
| `cacheContextStorage` | Yes | ALS instance, used by headers.ts to detect "use cache" scope |
| `getCacheContext()` | **No direct callers found** | Get current cache context |
| `replyToCacheKey()` | Yes (tests) | Convert encodeReply result to cache key string |
| `registerCachedFunction()` | Yes | Core runtime — called by Vite transform |
| `runWithPrivateCache()` | Yes | ALS scope for per-request private cache |
| `clearPrivateCache()` | **No direct callers found** | Legacy path for clearing private cache |

**Mapping to timber.js Phase 4:**

| cache-runtime.ts concept | Maps to | Decision |
|---------------------------|---------|----------|
| `registerCachedFunction()` | `timber.cache` + `"use cache"` runtime | **KEEP/REWRITE** — Core concept is sound. Must be rewritten to use timber's `CacheHandler` interface (simpler: `get/set/invalidate` vs Next.js's `get/set/revalidateTag`) |
| RSC stream serialization | Same | **KEEP** — Correctly handles React elements, client refs, Promises |
| `stableStringify` fallback | Same | **KEEP** — Needed for test environments without RSC |
| SHA-256 cache keys (FormData) | `timber.cache` key security | **KEEP** — Matches design/06-caching.md cache key security requirement |
| `unwrapThenableObjects` | Same | **KEEP** — Still needed for Next.js 15+ param compat |
| `CacheContext` ALS | Simplified | **REWRITE** — timber.cache uses explicit `{ ttl, tags }` options, not collected-during-execution metadata |
| `cacheLife()` minimum-wins | Not applicable | **DISCARD** — timber.cache uses explicit `ttl` option, no minimum-wins resolution |
| `"use cache: private"` per-request Map | `React.cache` equivalent? | **KEEP** — Per-request dedup is useful, but might be redundant with `React.cache` |
| Dev mode bypass | Same | **KEEP** — HMR compat is still needed |

### 2. `shims/cache.ts` — next/cache Public API

**What it does:**
- Defines the `CacheHandler` interface (matches Next.js 16)
- Implements `MemoryCacheHandler` (in-memory default)
- Provides `setCacheHandler()`/`getCacheHandler()` singleton management
- Exports public API: `revalidateTag`, `revalidatePath`, `unstable_cache`, `cacheLife`, `cacheTag`, `noStore`
- Manages request-scoped cacheLife config via ALS (for file-level "use cache" in page components)

**Exports:**

| Export | Used? | Purpose |
|--------|-------|---------|
| `CacheHandler` (interface) | Yes | Handler contract |
| `MemoryCacheHandler` | Yes | Default handler |
| `setCacheHandler()` | Yes | Handler injection |
| `getCacheHandler()` | Yes | Used by cache-runtime, isr-cache, fetch-cache |
| `revalidateTag()` | Yes | Public API |
| `revalidatePath()` | Yes | Public API |
| `updateTag()` | **Likely unused** | Next.js 16 API, no callers found |
| `refresh()` | **Likely unused** | Next.js 16 API, no-op implementation |
| `unstable_noStore()`/`noStore` | Yes | Marks dynamic usage |
| `unstable_cache()` | Yes | Legacy caching API |
| `cacheLife()` | Yes | "use cache" TTL control |
| `cacheTag()` | Yes | "use cache" tag assignment |
| `_runWithCacheState()` | **No callers found** | ALS scope for request-scoped cacheLife |
| `_initRequestScopedCacheState()` | **No callers found** | Legacy init for request-scoped cache |
| `_consumeRequestScopedCacheLife()` | **No callers found** | Consume request-scoped cacheLife |
| `_setRequestScopedCacheLife()` | Yes (from cacheLife) | Internal |
| Various type exports | Yes | Used by KV handler, ISR cache |

**Mapping to timber.js Phase 4:**

| cache.ts concept | Maps to | Decision |
|-------------------|---------|----------|
| `CacheHandler` interface | `CacheHandler` in design/06-caching.md | **REWRITE** — Simpler interface: `get/set/invalidate` (3 methods vs 4). No `kind` discriminated union needed |
| `MemoryCacheHandler` | `MemoryCacheHandler` | **KEEP/SIMPLIFY** — Timber version uses simpler `{ value, stale }` return instead of `CacheHandlerValue` |
| `setCacheHandler`/`getCacheHandler` | Same concept | **KEEP** |
| `revalidateTag()` | `timber.cache.invalidate({ tag })` | **RENAME** |
| `revalidatePath()` | `revalidatePath()` (re-renders, NOT cache invalidation) | **REWRITE** — Semantics change: timber's revalidatePath returns RSC payload, doesn't just invalidate |
| `unstable_cache()` | `timber.cache()` | **REPLACE** — timber.cache is the stable replacement |
| `cacheLife()` | `timber.cache({ ttl })` | **REPLACE** — Explicit TTL on wrapped function, not collected-during-execution |
| `cacheTag()` | `timber.cache({ tags })` | **REPLACE** — Explicit tags on wrapped function, not collected-during-execution |
| `noStore()` | Not needed | **DISCARD** — timber is SSR-first, no static/dynamic rendering split |
| Request-scoped cacheLife ALS | Not needed | **DISCARD** — No file-level "use cache" with implicit config |
| Cache value discriminated union (FETCH, APP_PAGE, PAGES, etc.) | Simpler types | **SIMPLIFY** — timber needs only data cache (FETCH equivalent) and RSC payload cache |
| `_N_T_` path tag convention | `path:/foo` convention per design doc | **RENAME** |

### 3. `server/isr-cache.ts` — ISR Layer

**What it does:**
- Wraps CacheHandler with stale-while-revalidate semantics
- Provides `isrGet()` — returns `{ value, isStale }` from CacheHandler
- Provides `isrSet()` — stores with revalidate duration
- Provides `triggerBackgroundRegeneration()` — deduped background re-renders
- Builds cache values: `buildPagesCacheValue()`, `buildAppPageCacheValue()`
- Computes cache keys with hash fallback for long pathnames
- Tracks revalidate durations in an LRU map for Cache-Control headers

**Exports:**

| Export | Used? | Purpose |
|--------|-------|---------|
| `isrGet()` | Yes | dev-server.ts, index.ts (Pages Router ISR) |
| `isrSet()` | Yes | dev-server.ts, index.ts (Pages Router ISR) |
| `triggerBackgroundRegeneration()` | Yes | dev-server.ts, index.ts (Pages Router ISR) |
| `buildPagesCacheValue()` | Yes | ISR cache value builder |
| `buildAppPageCacheValue()` | Yes | ISR cache value builder |
| `isrCacheKey()` | Yes | Hash-based cache key |
| `setRevalidateDuration()` | Yes | Cache-Control header support |
| `getRevalidateDuration()` | Yes | Cache-Control header support |

**Mapping to timber.js Phase 4:**

| isr-cache.ts concept | Maps to | Decision |
|-----------------------|---------|----------|
| ISR semantics (stale-while-revalidate on pages) | **No equivalent** | **DISCARD** — timber has no ISR (design/06-caching.md: "No ISR") |
| `isrGet/isrSet` | Not needed | **DISCARD** — No page-level ISR caching |
| `triggerBackgroundRegeneration()` | `timber.cache({ staleWhileRevalidate: true })` | **MOVE** — Singleflight/background revalidation moves into `timber.cache` runtime |
| Dedup map (`pendingRegenerations`) | Singleflight in `timber.cache` | **KEEP concept** — Reuse for `timber.cache` singleflight |
| `buildPagesCacheValue()` | Not needed | **DISCARD** — No Pages Router in timber |
| `buildAppPageCacheValue()` | Not needed | **DISCARD** — No ISR for rendered pages |
| `isrCacheKey()` hash-based key | May reuse for `timber.cache` keys | **KEEP concept** — Hash long keys for KV limits |
| Revalidate duration LRU tracking | Not needed | **DISCARD** — Timber doesn't derive Cache-Control from ISR config |

### 4. `cloudflare/kv-cache-handler.ts` — Cloudflare KV Handler

**What it does:**
- Implements `CacheHandler` interface using Cloudflare KV
- Stores entries as JSON with base64-encoded ArrayBuffers
- Tag-based invalidation via timestamp comparison (stores `__tag:` keys)
- Validates tags (blocks control chars, path separators, `:`)
- Validates cache entry shape on read (prevents deserialization attacks)
- KV TTL = 10x revalidation period (clamped 60s–30d) for stale-while-revalidate

**Exports:**

| Export | Used? | Purpose |
|--------|-------|---------|
| `KVCacheHandler` | Yes | Cloudflare deployment adapter |

**Mapping to timber.js Phase 4:**

| kv-cache-handler.ts concept | Maps to | Decision |
|------------------------------|---------|----------|
| KVCacheHandler class | Cloudflare adapter cache handler | **KEEP/REWRITE** — Implement new `CacheHandler` interface (simpler) |
| Tag validation (`:`, control chars) | Same | **KEEP** — Security-relevant |
| Entry shape validation | Same | **KEEP** — Defense against corrupted/malicious KV entries |
| ArrayBuffer serialization | **Simplify or DISCARD** | Only needed if timber caches binary data (APP_ROUTE, IMAGE). Timber likely only caches FETCH-equivalent (JSON/RSC) |
| Tag-based invalidation via timestamps | Same concept | **KEEP** |
| KV TTL calculation (10x revalidate) | Adapt to timber.cache TTL | **KEEP** — Same principle applies |

---

## ISR Semantics: Keep/Discard Decisions

Per design/06-caching.md: **"timber.js is SSR-first by default. There is no ISR."**

| ISR concept | Decision | Rationale |
|-------------|----------|-----------|
| Page-level stale-while-revalidate | **DISCARD** | No ISR. Pages render fresh on every request unless `"use cache"` is used |
| Background regeneration of pages | **DISCARD** | No ISR |
| Revalidate duration tracking | **DISCARD** | CDN caching is explicit via `Cache-Control` in middleware/proxy |
| Dedup map for concurrent regenerations | **KEEP for timber.cache** | Singleflight in `timber.cache` prevents thundering herd |
| `buildPagesCacheValue()` | **DISCARD** | No Pages Router |
| `buildAppPageCacheValue()` | **DISCARD** | No ISR for page output |
| `isrCacheKey()` hash function | **KEEP concept** | Useful for hashing long cache keys in KV |

**What stale-while-revalidate means in timber:**
- It's a `timber.cache` option (`staleWhileRevalidate: true`), not a page-level feature
- It applies to individual cached functions, not entire pages
- The dedup/singleflight logic from `isr-cache.ts` should be adapted for `timber.cache`

---

## KV Cache Handler: What to Preserve for Cloudflare Adapter

**Must keep:**
1. Tag validation (`validateTag`) — security-critical, prevents KV key injection
2. Entry shape validation (`validateCacheEntry`) — defense against corrupted data
3. Tag-based invalidation via timestamp comparison pattern
4. KV TTL calculation (entries must outlive their revalidate window)
5. Base64 encoding for binary data (if timber caches binary values)
6. `appPrefix` support for multi-app deployments

**Can simplify:**
1. ArrayBuffer serialization — timber's CacheHandler stores `{ value: unknown }`, not typed discriminated unions. Serialization is the handler's concern
2. Cache value types — only `{ value, stale }` return from `get()`, not the full `CacheHandlerValue`
3. No need for `PAGES`, `APP_PAGE`, `APP_ROUTE`, `REDIRECT`, `IMAGE` kind discrimination

**New requirements for timber:**
1. Implement `invalidate({ key?, tag? })` instead of `revalidateTag()`
2. Return `{ value: unknown, stale: boolean } | null` from `get()` instead of `CacheHandlerValue`
3. Accept `{ ttl: number, tags: string[] }` in `set()` instead of the complex context object

---

## Security Notes

Cross-referencing with design/13-security.md:

1. **Cache key determinism (test #14):** `stableStringify` sorts object keys. SHA-256 for FormData. Both preserved.
2. **Cache poisoning (vuln #5):** No patched `fetch`, explicit keys — matches timber design.
3. **"use cache" user data leak (test #15):** Dev-mode warning for request-specific props — concept should carry to timber.
4. **KV tag injection:** `validateTag` rejects `:`, control chars, path separators — carry forward.

---

## Summary: What Flows Into Phase 4

### Keep and adapt:
- `registerCachedFunction()` core logic → becomes `timber.cache()` runtime
- RSC stream serialization/deserialization for cached values
- SHA-256 cache key generation (security requirement)
- `stableStringify` fallback for non-RSC environments
- `unwrapThenableObjects` for Next.js 15+ compat
- Singleflight dedup from `isr-cache.ts`
- KVCacheHandler tag validation and entry shape validation
- Dev mode cache bypass for HMR

### Discard entirely:
- ISR layer (`isr-cache.ts`) — no ISR in timber
- Pages Router cache value builders
- `unstable_cache()` — replaced by `timber.cache()`
- `noStore()` — no static/dynamic split
- Request-scoped cacheLife ALS — no file-level "use cache" with implicit config
- `_N_T_` path tag prefix — use `path:/foo` convention
- `cacheLife()` minimum-wins resolution — timber uses explicit `ttl`
- Revalidate duration LRU tracking
- `updateTag()`, `refresh()` — Next.js 16 APIs with no-op implementation

### Simplify:
- `CacheHandler` interface: 3 methods instead of 4, simpler types
- Cache value types: no discriminated union, just `unknown`
- `cacheLife()`/`cacheTag()` → explicit `{ ttl, tags }` options on `timber.cache()`

### Dead code to clean up:
- `getCacheContext()` — no callers
- `clearPrivateCache()` — no callers (replaced by `runWithPrivateCache` ALS pattern)
- `_runWithCacheState()` — no callers
- `_initRequestScopedCacheState()` — no callers
- `_consumeRequestScopedCacheLife()` — no callers
