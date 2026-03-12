# Chunking Strategy

Research document for intelligent per-route chunking and user/library code splitting in timber.js.

## Current State

### Client Build Output

Currently Vite/Rollup produces a small number of chunks with no explicit `manualChunks` configuration:

**Benchmark fixture** (3 routes):

```
index-*.js              256 KB (81 KB gzip)   ← react + react-dom + timber runtime + scheduler
page-*.js                 0.35 KB             ← single client component (Counter)
rsc-client-entry-*.js     1.63 KB             ← RSC client reference facades
```

**Kitchen-sink** (12+ routes):

```
index-*.js              258 KB (82 KB gzip)   ← react + react-dom + timber + scheduler
page-*.js                74 KB (20 KB gzip)   ← search-params page (large client component)
error-*.js                2.5 KB              ← error boundary components
Counter-*.js              0.4 KB              ← shared Counter component
rsc-client-entry-*.js     1.5 KB              ← RSC facades
404-*.js, 401-*.js, etc   ~1 KB each          ← error page components
```

**Composition of the main client chunk** (from benchmark analysis):

- React + React-DOM + scheduler: 671 KB (raw) — 87% of chunk
- timber runtime: 89 KB (raw) — 12%
- Other: 5 KB — 1%
- App code: 0 KB — entirely in separate chunks

### Server Build Output

**RSC**: One large `index.js` (304–333 KB) + per-route chunks (0.1–13 KB each)
**SSR**: One large `index.js` (635–637 KB) + per-route chunks (0.05–37 KB each)

### What Works Well

1. **Per-route page/layout components** are already split — each `page.tsx` and `layout.tsx` gets its own chunk in all environments
2. **Shared components** (Counter, error boundaries) are extracted into common chunks
3. The `BuildManifest` already tracks per-file JS/CSS/modulepreload mappings, so the runtime correctly loads only the chunks needed for a given route

### What Could Be Better

1. **One monolithic framework chunk** — react, react-dom, scheduler, and timber runtime all live in `index-*.js`. Changing timber invalidates the react cache.
2. **No cache tier separation** — libraries that change yearly (react) share a hash with code that changes weekly (timber runtime)
3. **Server bundles are large** — the RSC index.js includes the entire timber request pipeline in one file

---

## How Other Frameworks Handle This

### Next.js (Granular Chunks)

Next.js uses webpack's `splitChunks` with multiple cache groups:

| Cache Group  | Contents                                    | Update Frequency  |
| ------------ | ------------------------------------------- | ----------------- |
| `framework`  | react, react-dom, scheduler, next internals | Monthly           |
| `lib-[name]` | Any npm package >160 KB                     | Varies by package |
| `commons`    | Code shared by >50% of pages                | Per deploy        |
| Per-page     | Code unique to a single page                | Per deploy        |

Key insight: **cache tiers based on update frequency**. Users who deploy daily don't want to invalidate a 80 KB gzipped react chunk on every deploy.

### Remix / React Router

Remix relies on Vite's default chunking with route-based entry points. Each route is a separate entry, and Vite/Rollup naturally splits shared code. No explicit `manualChunks`.

### Vinext (Cloudflare RSC-on-Vite)

Vinext uses Vite defaults. No custom chunking configuration. Server bundles are single-file for Workers.

---

## Proposed Strategy

### Client Environment: Three Cache Tiers

Use Rollup `manualChunks` to create three cache tiers based on update frequency:

```
Tier 1: vendor-react-*.js   — react, react-dom, scheduler
Tier 2: vendor-timber-*.js  — @timber/app runtime, react-server-dom-*, @vitejs/plugin-rsc runtime
Tier 3: [route]-*.js        — per-route page/layout chunks (already happening)
        [shared]-*.js       — shared app components (already happening)
```

**Implementation** in `timber-entries` or a new `timber-chunks` plugin:

```ts
// In config hook, inject rollupOptions for the client environment
config(config) {
  if (this.environment?.name !== 'client') return;
  return {
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react-dom') ||
                id.includes('node_modules/react/') ||
                id.includes('node_modules/scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('/timber-app/') ||
                id.includes('react-server-dom') ||
                id.includes('@vitejs/plugin-rsc')) {
              return 'vendor-timber';
            }
            // Let Rollup handle everything else (per-route splitting)
          },
        },
      },
    },
  };
}
```

**Measured impact (benchmark fixture):**

| Chunk                   | Before              | After               | Change                  |
| ----------------------- | ------------------- | ------------------- | ----------------------- |
| `vendor-react-*.js`     | —                   | 217 KB (68 KB gzip) | Extracted from monolith |
| `index-*.js` (timber)   | —                   | 40 KB (14 KB gzip)  | Extracted from monolith |
| `index-*.js` (monolith) | 256 KB (81 KB gzip) | —                   | Split into above        |
| Route chunks            | 0.35 KB             | 0.36 KB             | No change               |

**Cache benefit:** The `vendor-react` chunk hash is stable across deploys that don't change React versions. Users who deploy daily save ~68 KB gzip on repeat visits.

**Cache benefit:** For apps that deploy daily, users cache react for weeks/months instead of re-downloading on every deploy.

### Server Environments: No Custom Chunking (Yet)

**RSC and SSR run on Cloudflare Workers**, where:

- There are no network requests between chunks — everything is loaded from the single worker bundle
- Dynamic `import()` works but adds no benefit since all code ships in one deployment
- The 10 MB compressed bundle limit (paid) is not close to being hit
- Cold start time is dominated by V8 parsing, not chunk count

**Recommendation: Leave server chunking to Vite defaults.** The per-route splitting already happening is sufficient. Optimizing server chunk count would add complexity with no measurable benefit. Revisit if:

- Worker bundles approach the 10 MB limit
- Cold start measurements show parsing overhead from large single chunks

### Large Library Splitting (Future)

For apps importing large client-side libraries (e.g., chart.js, Monaco editor, three.js), consider a `lib-*` tier that extracts any `node_modules` package over a size threshold into its own chunk. This matches Next.js's approach.

**Not recommended for v1** — over-splitting hurts HTTP/2 multiplexing and increases total bytes due to per-chunk overhead. Only add if real apps show the need.

---

## Trade-offs

### Pros of Explicit Chunking

1. **Better cache hit rates** — React chunk survives most deploys
2. **Clearer mental model** — developers can reason about what's in each bundle
3. **Easier performance debugging** — bundle composition is predictable

### Cons

1. **More HTTP requests** — 3 chunks instead of 1 on first load (mitigated by HTTP/2 + modulepreload)
2. **Rollup `manualChunks` can conflict with the RSC plugin** — needs testing to ensure the RSC plugin's client reference tracking still works
3. **Maintenance burden** — heuristics for categorizing modules can break when dependencies change internal paths

### Cloudflare Workers Constraints

| Constraint                           | Impact                                          |
| ------------------------------------ | ----------------------------------------------- |
| 10 MB compressed bundle limit (paid) | Not close to hitting — no action needed         |
| 1 MB free tier limit                 | Could matter for small apps — monitor           |
| No persistent disk cache             | Server chunking provides no cache benefit       |
| Cold start time                      | Dominated by V8 compile, not chunk organization |

---

## Recommended Next Steps

1. **Prototype the 3-tier client split** — Add `manualChunks` in a new `timber-chunks` plugin, measure impact on kitchen-sink build
2. **Verify RSC plugin compatibility** — Ensure `@vitejs/plugin-rsc` client reference manifest correctly tracks modules across manual chunks
3. **Benchmark first load vs repeat load** — Measure total bytes transferred on first visit vs subsequent visits after a "timber-only" change
4. **Add chunk composition to CI benchmarks** — Extend the existing `benchmarkAnalyze` plugin to report per-tier sizes, flag regressions

---

## Non-Goals

- **Dynamic import()-based route splitting in the client** — timber.js already gets per-route chunks via the RSC architecture. Each page/layout is a separate entry point. Adding `React.lazy()` wrappers would conflict with the RSC streaming model.
- **Aggressive per-component splitting** — Over-splitting creates waterfall requests. The current behavior of shared components getting extracted into common chunks is correct.
- **Tree-shaking of react** — React and React-DOM don't tree-shake well. The production build fix (react-prod plugin) already reduced React bundle size by 56%.
