# Data Fetching

## Components Own Their Data

There is no framework-level data loading layer. No `getServerSideProps`. No loader. Data lives in components, next to the UI that renders it.

```typescript
async function UserAvatar() {
  const user = await getUser()
  return <img src={user.avatar} />
}

async function DashboardHeader() {
  const user = await getUser()  // same request, cache hit
  return <header>Hello {user.name}</header>
}
```

## Deduplication via React `cache()`

Multiple components calling the same async function within the same request is not a problem. React `cache()` deduplicates calls per request — the first call fetches, subsequent calls return the same promise. This is an existing React primitive. The framework does not need to invent anything here.

```typescript
// lib/data.ts
import { cache } from 'react';

export const getUser = cache(async (req?: Request) => {
  return db.users.findBySession(req ?? headers());
});
```

Any component at any depth in the tree can call `getUser()`. It executes once per request. No prop drilling. No context. No query client.

## Layouts Are Async

Layouts are async server components. They can fetch their own data. There is no requirement that layouts be synchronous or "presentational only." A layout that awaits data extends the pre-flush window — it participates in the status code decision by virtue of running before `onShellReady`.

**Async layouts are re-rendered on every navigation** — the framework always re-renders async layouts during segment tree diffing (see [Segment Tree Diffing](07-routing.md#segment-tree-diffing-on-navigation)). Only sync layouts are cached while mounted. However, access control still belongs in `access.ts`, not in layouts — `access.ts` runs on every navigation regardless of layout caching (see [Authorization](04-authorization.md)).

```typescript
// app/dashboard/layout.tsx
export default async function DashboardLayout({ children }) {
  const org = await getOrg()  // fetches, extends pre-flush time
  return (
    <div>
      <OrgNav org={org} />
      {children}
    </div>
  )
}
```

The tradeoff is explicit: async layouts make pages slower to flush. That is the developer's choice to make, not the framework's to prevent.

---

## Runtime Integration

`timber.cache` talks to the `CacheHandler` directly — no ALS dependency for cache handler operations. It works everywhere:

- **Render pass** — inside `renderToReadableStream`, components call `timber.cache`-wrapped functions. Cache lookups and writes go directly to the `CacheHandler`.
- **`middleware.ts`** — fire-and-forget prefetches populate the cache before rendering starts. `React.cache` is not active here; `timber.cache` provides its own dedup via the cache handler.
- **`waitUntil()`** — post-response work can write to the cache (e.g., warming entries for anticipated follow-up requests).
- **Module init** — top-level `timber.cache` calls in module scope work. The cache handler is initialized before any module code runs.
- **Background jobs / cron triggers** — `timber.cache.invalidate()` and cache writes work outside the request lifecycle entirely.

`React.cache` is a separate concern — it only works inside `renderToReadableStream`. Functions that need to work across all contexts (page routes, API routes, middleware, background jobs) should use `timber.cache`, not `React.cache`. See [Caching — Relationship to React.cache](06-caching.md#relationship-to-reactcache) for the full comparison.

---

## Error Handling in Data Functions

Failed data fetches propagate as render errors through the React tree:

**Outside `<Suspense>`** — a thrown error bubbles up to the nearest error boundary (`error.tsx`, `5xx.tsx`). Because timber.js holds flush until `onShellReady`, the error is caught before the status code commits. The response is a correct HTTP 500 with the error boundary rendered as the body.

**Inside `<Suspense>`** — a thrown error triggers the Suspense boundary's error fallback. If the status has already committed (post-flush), the error boundary is streamed into the open connection with the status already set to 200.

**`timber.cache` with `staleWhileRevalidate`** — when a background refetch fails, the stale entry continues to be served. The error is logged via `onRequestError` in `instrumentation.ts`. No user-facing error occurs.

**Recommended pattern:** Use `deny(404)` for expected "not found" cases. Reserve thrown errors for unexpected failures:

```typescript
export const getProduct = timber.cache(
  async (id: string) => {
    const product = await db.products.find(id);
    if (!product) deny(404); // expected — renders 404.tsx with correct status
    return product;
  },
  { ttl: 60, tags: (id) => [`product:${id}`] }
);
```

---

## Code Organization

Data functions live in `lib/` (or `src/lib/`), co-located with the domain they serve — not in route files. Route files (`page.tsx`, `layout.tsx`, `middleware.ts`) call data functions but don't define them.

```
lib/
  auth.ts           ← requireUser(), getUser(), requireAdmin()
  products.ts       ← getProduct(), getPopularProducts(), getProductReviews()
  organizations.ts  ← getOrg(), getOrgMembers()
```

Each data file exports `timber.cache`-wrapped functions. `React.cache` wrappers (when needed for per-request dedup of uncached functions) live in the same file:

```typescript
// lib/products.ts
import { cache } from 'react';
import { cache as timberCache } from '@timber-js/app/cache';

// Cross-request cached — TTL, tags, shared across requests
export const getProduct = timberCache(async (id: string) => db.products.find(id), {
  ttl: 60,
  tags: (id) => [`product:${id}`],
});

// Per-request dedup only — no cross-request caching
// Use for functions that must always be fresh per-request
export const getCurrentCart = cache(async () => {
  const user = await requireUser();
  return db.carts.findByUser(user.id);
});
```

**Why separate files?** Data functions are shared across routes. A `getProduct()` function is called from `products/[id]/page.tsx`, `products/[id]/middleware.ts`, `products/[id]/access.ts`, and potentially `cart/page.tsx`. Co-locating with one route file would make the others import across route boundaries.

---

## Waterfalls and Prefetching

Sequential `await` calls in the React tree create waterfalls — each component awaits its data before rendering children. This is inherent to React Server Components and is not a framework problem to solve.

The framework provides two tools to mitigate waterfalls:

1. **`middleware.ts` prefetching** — fire-and-forget calls in middleware warm the `timber.cache` before rendering starts. When components call the same functions, they hit the warm cache:

```typescript
// app/products/[id]/middleware.ts
export default async function middleware(ctx: MiddlewareContext) {
  // Fire all fetches in parallel — do NOT await
  void getProduct(ctx.params.id);
  void getProductReviews(ctx.params.id);
  void getRelatedProducts(ctx.params.id);
}
```

2. **`<Suspense>` boundaries** — wrap independent sections in Suspense to stream them after the shell. The shell flushes with the status code; slow secondary content streams in later.

**Explicit is better.** timber.js does not auto-parallelize data fetches, auto-insert Suspense boundaries, or hoist data requirements. The developer decides what runs in parallel (middleware prefetches), what blocks the shell (components outside Suspense), and what streams (components inside Suspense).
