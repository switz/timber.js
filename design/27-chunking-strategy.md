# Chunking Strategy

Design document for client chunk splitting in timber.js.

## Current Strategy (LOCAL-337)

### Approach: Natural Code Splitting

timber.js uses **no manual chunk splitting**. Rolldown handles natural code splitting via route-based entry points, producing:

- **1 main bundle** — React, ReactDOM, scheduler, timber runtime, shared app code, user vendors
- **Per-route chunks** — page/layout components split naturally when route-specific
- **rolldown-runtime** — Rolldown's own module runtime (unavoidable, ~558B)

### Client Build Output

**phase2-app fixture** (31 routes):

```
index-*.js            ~233 KB — everything (React + timber + app + vendors)
link-*.js              ~3 KB  — Link component + navigation context
react-*.js             ~8 KB  — shared React re-exports
[route]-*.js           varies — per-route page/layout chunks (natural splitting)
```

2-4 framework chunks + per-route chunks. Much simpler than the previous 5-tier approach.

### Why This Works

1. **Fewer HTTP requests** — One main bundle instead of 5+ cache-tier chunks
2. **No module duplication** — With a single module graph and no manual chunk boundaries, shared modules are naturally deduplicated by Rolldown
3. **No singleton workarounds needed** — The previous `globalThis + Symbol.for` pattern in `navigation-context.ts` was only needed because `manualChunks` caused the module to be duplicated across chunks. Without manual chunking, each module lives in exactly one chunk.
4. **Simpler architecture** — No `assignChunk`, `assignClientChunk`, or cache-tier categorization logic

### Server Environments: No Custom Chunking

**RSC and SSR run on Cloudflare Workers**, where:

- There are no network requests between chunks — everything is loaded from the single worker bundle
- Dynamic `import()` works but adds no benefit since all code ships in one deployment
- The 10 MB compressed bundle limit (paid) is not close to being hit
- Cold start time is dominated by V8 parsing, not chunk count

Per-route splitting already happens naturally via Vite defaults.

---

## Previous Strategy (Removed in LOCAL-337)

The previous approach used `manualChunks` to create 5 cache tiers based on update frequency:

```
Tier 1: vendor-react-*.js   — react, react-dom, scheduler
Tier 2: vendor-timber-*.js  — timber runtime, RSC runtime
Tier 3: vendor-app-*.js     — user node_modules
Tier 4: shared-app-*.js     — small shared app utilities (< 5KB source)
        shared-client-*.js  — small 'use client' facade wrappers
Tier 5: [route]-*.js        — per-route page/layout chunks
```

### Why It Was Removed

1. **Too many HTTP requests** — 7 chunks for a simple app, 3 of which were nearly empty wrappers (vendor-timber at 404B, shared-client at 696B, rolldown-runtime at 558B)
2. **Module duplication across chunks** — The RSC client build creates two entry graphs (browser entry + client references). Both imported `navigation-context.ts`, and `manualChunks` couldn't prevent Rolldown from inlining entry-adjacent modules. This created duplicate module instances where React context provider and consumer used different context objects.
3. **Required globalThis workaround** — To fix the duplication, all shared mutable state in `navigation-context.ts` had to use `globalThis` via `Symbol.for` keys, adding complexity and making the code harder to understand.
4. **Cache benefit was theoretical** — In practice, deploy frequency varies, and the added HTTP requests and architecture complexity outweighed the potential cache wins.

### Singleton Safety (No Longer Needed)

The previous `globalThis + Symbol.for` pattern used these keys:

| `Symbol.for` Key           | What It Stored                             |
| -------------------------- | ------------------------------------------ |
| `__timber_nav_ctx`         | `NavigationContext` (React context)        |
| `__timber_pending_nav_ctx` | `PendingNavigationContext` (React context) |
| `__timber_nav_state`       | `{ params, pathname }` mutable state       |

With natural code splitting, `navigation-context.ts` lives in exactly one chunk. Plain module-level variables work correctly — no cross-chunk duplication to work around.

---

## Trade-offs of Current Approach

### Pros

1. **Simpler architecture** — No chunk categorization logic, no `manualChunks`, no `clientChunks` callback
2. **Fewer HTTP requests** — One main bundle on first load
3. **No singleton workarounds** — Module-level variables work as expected
4. **Easier debugging** — Bundle composition is straightforward

### Cons

1. **No cache-tier separation** — Changing timber invalidates the React chunk too (both in one bundle). Users re-download ~68KB gzip React on every deploy.
2. **Potentially revisitable** — If real apps show measurable performance regression from cache misses, cache tiers can be re-added with a more careful approach that avoids module duplication.

### Cloudflare Workers Constraints

| Constraint                           | Impact                                          |
| ------------------------------------ | ----------------------------------------------- |
| 10 MB compressed bundle limit (paid) | Not close to hitting — no action needed         |
| 1 MB free tier limit                 | Could matter for small apps — monitor           |
| No persistent disk cache             | Server chunking provides no cache benefit       |
| Cold start time                      | Dominated by V8 compile, not chunk organization |

---

## Non-Goals

- **Dynamic import()-based route splitting in the client** — timber.js already gets per-route chunks via the RSC architecture. Each page/layout is a separate entry point. Adding `React.lazy()` wrappers would conflict with the RSC streaming model.
- **Aggressive per-component splitting** — Over-splitting creates waterfall requests. The current behavior of shared components getting extracted into common chunks is correct.
- **Tree-shaking of react** — React and React-DOM don't tree-shake well. The production build fix (react-prod plugin) already reduced React bundle size by 56%.
