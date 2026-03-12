# Future: Pre-Rendering & Static Shell Optimization

> **Status: DEFERRED.** This document preserves design thinking for the static shell optimization within `server` mode, `'use dynamic'`, and `prerender.ts`. These features are not part of v1. They are included here so the design work is not lost.

---

## Static Shell Optimization (within `server` mode)

Shell cached at build time. `'use dynamic'` marks per-request holes that block the flush. `<Suspense>` marks secondary content that streams after the status commits. Dynamic segments without `generateParams` fall back to SSR with a structured build diagnostic.

### `access.ts` and Segment Caching

`access.ts` always runs fresh on every request — auth is never cached. This is true across all output modes. Because `AccessGate` is a separate component from the layout in the element tree, it executes even when the layout below it is served from cache.

In `server-with-static-shell` mode, layout segments without `'use dynamic'` can cache their flight payloads. On each request, the framework:

1. Builds the element tree with `AccessGate` wrappers (always runs fresh)
2. For each segment, checks if a cached flight payload exists with matching params
3. Cache hit: skip layout render, use cached payload
4. Cache miss: render layout, cache the payload

Segments with `'use dynamic'` always re-render per-request. They cannot be cached by definition.

In cached segments, `timber.cache` calls within the layout return data from the request that built the cache entry, not the current request. This is fine because cached layouts should not depend on per-request identity — that's what `'use dynamic'` is for.

### Dynamic Segments Without `generateParams`

`prerender.ts` is optional for static segments — the framework pre-renders the single URL. For dynamic segments like `[id]`, `generateParams` is required to know which param values to pre-render. Without it, the framework cannot enumerate URLs.

When a dynamic segment has no `generateParams` in `server-with-static-shell` mode:

- The build succeeds — the route falls back to SSR
- A structured build diagnostic is emitted (`DYNAMIC_SEGMENT_NO_PARAMS`) listing affected routes
- The build manifest records the route as `renderMode: 'ssr'` explicitly
- The build summary reports: "N routes have a cached shell. M routes are SSR-only."
- In dev mode, a dev overlay indicates the route has no cached shell

---

## `prerender.ts`

The presence of `prerender.ts` in a route segment signals to the framework: pre-render this route's shell at build time.

```typescript
// app/docs/[slug]/prerender.ts
import { db } from '@/lib/db';

// required for dynamic segments — which param values to pre-render
export async function generateParams() {
  const docs = await db.docs.findAll();
  return docs.map((doc) => ({ slug: doc.slug }));
}

export const ttl = '1h';
export const tags = ['docs'];
```

`generateParams` is required for dynamic route segments — unless `fallback: 'shell'` is set (see below). For static segments (no `[param]`), it is optional — the framework pre-renders the single URL.

`ttl` controls how long the cached shell is considered fresh. `tags` enable targeted invalidation — calling `revalidateTag('docs')` purges all pre-rendered shells tagged with `'docs'`.

### Fallback Shells for Dynamic Routes Without `generateParams`

For dynamic routes where params are not known at build time — e.g. `/users/[id]` backed by a database with millions of rows — `generateParams` is impractical. `fallback: 'shell'` opts the route into a single pre-rendered shell that serves as a client-side fallback for any unmatched param.

```typescript
// app/users/[id]/prerender.ts
export const fallback = 'shell';
export const ttl = '7d';
```

timber.js emits a single `users/shell.html` at build time and writes a `_redirects` entry (for Cloudflare Pages) or equivalent routing rule (for other static hosts):

```
/users/*  /users/shell.html  200
```

The shell renders server-side at build time **without params** — so server components in the route cannot read `params.id`. The dynamic component must be `'use client'`, read its own param via `useParams()`, and fetch data itself using `<Suspense>` for the loading state.

**Constraints:**

- `fallback: 'shell'` is only valid in `static` mode. In `server` or `server-with-static-shell`, unknown params render per-request — no fallback needed.
- Server components in the route cannot access `params` — they render at build time without a request context.
- `middleware.ts` files do not run at request time in `static` mode. Auth must be handled client-side or by a separate API layer.
- `'use dynamic'` is still a build error in `static` mode — the shell is static.

---

## `'use dynamic'`

`'use dynamic'` is a directive placed at the top of a server component function body. It declares a dynamic boundary — the component and everything rendered beneath it opts out of the pre-rendered shell and renders per-request. It participates in the pre-flush phase and can affect the status code.

```tsx
export default async function AddToCartButton({ productId }) {
  'use dynamic';
  const user = await getUser(); // reads request context — not available at build time
  return <button>Add to cart</button>;
}
```

`'use dynamic'` is only meaningful inside a pre-rendered route. In a standard SSR route, everything is already per-request — the directive is a no-op. It requires a Vite plugin transform, consistent with how `'use client'` and `'use server'` are handled.

### `'use dynamic'` and `'use cache'`

Both directives can be declared on the same component. They operate on different axes:

- `'use dynamic'` — opt out of the pre-rendered shell; this subtree renders at request time
- `'use cache'` — cache this component's output for the specified duration

Together they mean: render per-request (so the component can access cookies, headers, or user identity), but cache the output for N duration rather than re-rendering on every request.

### `'use dynamic'` and the React Tree

`'use dynamic'` components are rendered as part of the **same React tree** as the cached shell — not as separate render passes. The cache stores an RSC flight payload (a serialized React tree), not an HTML fragment. At request time, the framework re-renders the full tree once: cached portions are replayed from the stored payload, `'use dynamic'` components are rendered fresh.

> **Implementation note:** The mechanism for partial replay is intentionally undesigned — this is a Phase 5 concern. React's `renderToReadableStream` does not natively support replaying cached subtrees while rendering fresh subtrees in the same pass. The approach will be investigated when this phase begins; no decision has been made to constrain the design space prematurely.

### `'use dynamic'` and `<Suspense>`

`'use dynamic'` and `<Suspense>` are orthogonal:

- `'use dynamic'` is about **cache scope** — this subtree opts out of the pre-rendered shell
- `<Suspense>` is about **flush timing** — this subtree streams after the status commits

|                         | Cached        | Per-request     |
| ----------------------- | ------------- | --------------- |
| **Blocks flush**        | default shell | `'use dynamic'` |
| **Streams after flush** | ---           | `<Suspense>`    |

### `cookies()` and `headers()` in Pre-Rendered Routes

Pre-rendered components run at build time. `cookies()` and `headers()` return nothing at build time — there is no request. Calling them inside a pre-rendered component is a developer error. Dev-mode warning is emitted.

### `searchParams` in Pre-Rendered Routes

`searchParams` vary per-request and cannot be known at build time. A pre-rendered component that reads `searchParams` gets an empty object at build time. Dev-mode warning applies.

---

## Example: Pre-Rendered Product Page

See git history for the full example that was previously in `12-example.md`. It demonstrated:

- `prerender.ts` with `generateParams`, `ttl`, and `tags`
- `middleware.ts` running on every request even with a cached shell
- `'use dynamic'` components for per-user content (cart button, pricing)
- `<Suspense>` for streaming secondary content (reviews)
- Server actions with `revalidateTag` to purge shells
