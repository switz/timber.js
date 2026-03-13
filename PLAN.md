# timber.js — Implementation Plan

> If Rails/PHP could do it, so can we. Correct HTTP semantics, real status codes, pages that work without JavaScript, streaming only where you ask for it.

**What it is not:** A Next.js replacement. Not API-compatible. No pages router. Forward-looking only.

Design docs: [`design/`](design/README.md) — read these before implementing any phase.

---

## Starting Point

timber.js is a fresh implementation — all code is written from scratch against the design docs. Vinext and Next.js serve as reference for understanding the problem space, not as a codebase to fork or migrate from.

- [x] Set up fresh repo with `@timber/app` package
- [x] Design docs written as the source of truth for all behavior

### Upstream Monitoring

timber.js monitors Vinext and Next.js upstream for bug fixes and security patches. When an upstream fix addresses a vulnerability class that could also exist in timber.js's independent codebase, we evaluate and implement our own fix. See `/upstream-triage` and `/upstream-bugwatch` commands.

---

## Phase 1 — Core Pipeline

The rendering pipeline: correct HTTP status codes, unified element tree, access gates, per-route middleware. Everything else builds on this.

**Dependencies:** Fork cleanup must be complete.

### 1a. Route Discovery

- [ ] Scan `app/` directory for all file conventions: `page.*`, `layout.*`, `middleware.ts`, `access.ts`, `route.ts`, `error.tsx`, `4xx.tsx`, `5xx.tsx`, `{status}.tsx`, `denied.tsx`, `default.tsx`
- [ ] Build segment chain from matched route path
- [ ] Identify leaf route (the deepest matched `page.tsx` or `route.ts`)
- [ ] Configurable `pageExtensions` in `timber.config.ts` (default: `tsx`, `ts`, `jsx`, `js`)
- [ ] MDX as a valid page extension when configured
- [ ] `route.ts` and `page.tsx` in the same segment is a hard build error

### 1b. Request Pipeline

- [ ] Wire `proxy.ts` — function form: `(req, next) => Response`
- [ ] Wire `proxy.ts` — array form: each item is `(req, next) => Response`, compose left-to-right
- [ ] Uncaught error in `proxy.ts` → bare HTTP 500, no body, server-side log
- [ ] URL canonicalization before `proxy.ts` sees the request:
  - [ ] Single percent-decode (no double-decode)
  - [ ] `//` collapse and `..` resolution
  - [ ] Encoded separator rejection: `%2f`, `%5c` → 400
  - [ ] Null byte rejection: `%00` → 400
  - [ ] Backslash normalization: `\` treated as literal, not path separator
- [ ] Route matching after `proxy.ts`
- [ ] 103 Early Hints at route-match time (before middleware/access/render) — hint segment CSS, client JS chunks, fonts from build manifest
- [ ] Per-route `middleware.ts` runner:
  - [ ] Only leaf route's middleware runs — no chain
  - [ ] Blocking — runs before element tree is built
  - [ ] One-arg signature: `middleware(ctx: MiddlewareContext)`
  - [ ] `MiddlewareContext`: `{ req: Request, requestHeaders: Headers, headers: Headers, params, searchParams }`
  - [ ] `ctx.req` — original immutable Request
  - [ ] `ctx.requestHeaders` — mutable Headers visible downstream via `headers()`; original request never mutated
  - [ ] `ctx.headers` — response headers applied at flush time
  - [ ] `ctx.params` always fully resolved (extracted by route matcher before middleware runs)
  - [ ] Middleware returning a `Response` short-circuits — render never starts
  - [ ] Middleware throwing → HTTP 500, no render
  - [ ] `middleware.ts` runs for both page routes and `route.ts` API endpoints

### 1c. Element Tree & Flush

- [ ] Build unified element tree bottom-up for matched route:
  - [ ] Page wrapped in `{status}.tsx` / `4xx.tsx` / `5xx.tsx` / `error.tsx` boundaries (fallback chain)
  - [ ] Each layout wrapped by `AccessGate` above it
  - [ ] Parallel slots composed as named props with `SlotAccessGate` wrappers
- [ ] Single `renderToReadableStream(tree)` call — one `React.cache` scope for entire route
- [ ] Hold flush until `onShellReady`
- [ ] On `onShellReady`: commit correct HTTP status, flush shell, stream Suspense remainders
- [ ] Render-phase signals (`deny()`, `redirect()`, unhandled throw) caught before flush → correct status code

### 1d. Access Gates

- [ ] `AccessGate` async server component injected above each layout
- [ ] Calls segment's `access.ts` with `AccessContext: { params, searchParams }` before layout renders
- [ ] `access.ts` in slot → `SlotAccessGate` wrapper instead
- [ ] Shallowest failure wins — React renders top-down, failing gate stops children
- [ ] Segment `deny()` → correct HTTP status, renders nearest status-code file via fallback chain
- [ ] Slot `deny()` → graceful degradation: `denied.tsx` → `default.tsx` → `null`, HTTP status unaffected
- [ ] `redirect()` in slot `access.ts` → dev-mode error (not allowed in slot context)
- [ ] Parent segment access failure → all slots denied (parent blocks children)
- [ ] Slot access does not run when route doesn't match the slot (no `default.tsx` check needed)
- [ ] `access.ts` runs for `route.ts` API endpoints too (outside React tree — `React.cache` not active)

### 1e. Primitives

- [ ] `deny(status?, data?)` — context-dependent:
  - [ ] Segment context → HTTP status (`deny()` = 403), renders status-code file, `data` passed as props
  - [ ] Slot context → graceful degradation to `denied.tsx`, `data` passed as `{ slot }` props
  - [ ] Post-flush Suspense → injects `<meta name="robots" content="noindex">`, triggers error boundary
- [ ] `redirect(url, status?)` — relative-only (reject absolute URLs), HTTP 302 by default
  - [ ] Pre-flush: correct HTTP redirect
  - [ ] Post-flush Suspense: client-side navigation
- [ ] `redirectExternal(url, allowList)` — explicit allow-list, prevents open redirect
- [ ] `RenderError` — typed throw with plain-data digest and optional HTTP status
  - [ ] `new RenderError(code, data, { status })`
  - [ ] Client error boundaries receive `RenderErrorDigest<Code, Data> | null` as `digest` prop
- [ ] `waitUntil(promise)` — post-response work, callable from middleware/components/actions
  - [ ] Cloudflare: maps to `ctx.waitUntil()`
  - [ ] Node.js: keep request context alive until all promises settle
  - [ ] Unsupported adapters: warn once at startup (not per-call)

### 1f. Status-Code File Conventions

- [ ] `{status}.tsx` for any specific 4xx or 5xx code (e.g. `429.tsx`, `503.tsx`)
- [ ] `4xx.tsx` — catch-all for any 4xx without a specific file
- [ ] `5xx.tsx` — catch-all for any 5xx without a specific file
- [ ] `error.tsx` — React error boundary (client component), catches all unhandled render errors
- [ ] `denied.tsx` — slot-only, renders when slot `access.ts` calls `deny()`
- [ ] Fallback chain: specific file → category file → `error.tsx` → walk up segment tree → root → framework default
- [ ] 4xx files receive `{ status, dangerouslyPassData }` props (`dangerouslyPassData` from `deny(status, data)`)
- [ ] 5xx / `error.tsx` files receive `{ error, digest, reset }` props
- [ ] `denied.tsx` receives `{ slot: string, dangerouslyPassData?: unknown }` props (slot name without `@`, data from `deny()`)

### 1g. `route.ts` API Endpoints

- [ ] Export named functions: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`
- [ ] Automatic 405 with `Allow` header for unhandled methods
- [ ] Automatic OPTIONS response (lists allowed methods) when `OPTIONS` not exported
- [ ] `route.ts` and `page.tsx` in the same directory is a build error
- [ ] One-arg signature: `GET(ctx: RouteContext)`, `POST(ctx: RouteContext)`, etc.
- [ ] `RouteContext`: `{ req: Request, params, searchParams: URLSearchParams, headers: Headers }`
- [ ] Streaming SSE: return `ReadableStream` in a `Response`
- [ ] Pipeline: `proxy.ts` → route match → `middleware.ts` → `access.ts` → method handler

### 1h. Security

- [ ] CSRF: Origin header validation by default, auto-derived from `Host` header
  - [ ] `allowedOrigins` list in `timber.config.ts` for multi-origin deployments
  - [ ] `csrf: false` to disable
- [ ] FormData limits: configurable `actionBodySize`, `uploadBodySize`, `maxFields` in `timber.config.ts`
  - [ ] Exceeding limits → 413 response
- [ ] No global ALS fallback state — if ALS store unavailable, fail with error (prevents cross-request pollution)

### 1i. Metadata

- [ ] `metadata` static export on `page.tsx` and `layout.tsx`
- [ ] `generateMetadata(props)` async function export — resolves inside render pass, outside Suspense
- [ ] Title templates: `{ default, template, absolute }`
- [ ] Shallow merge: page metadata wins over layout metadata
- [ ] `metadataBase` for resolving relative URLs in metadata fields
- [ ] Default charset + viewport meta injection (no separate Viewport type)
- [ ] Error state: parent layout metadata applies, page metadata lost, auto `noindex` injected
- [ ] Metadata routes (file conventions):
  - [ ] `sitemap.ts` / `sitemap.xml`
  - [ ] `robots.ts` / `robots.txt`
  - [ ] `manifest.json` / `manifest.ts`
  - [ ] `favicon.ico`, `icon.png/tsx`, `apple-icon.png/tsx`
  - [ ] `opengraph-image.tsx`, `twitter-image.tsx`
  - [ ] `ImageResponse` API for dynamic image generation
  - [ ] Auto-linked in `<head>`
  - [ ] Metadata routes run through `proxy.ts` only — NOT `middleware.ts` or `access.ts`

### 1j. Phase 1 Testing

- [ ] All HTTP status code paths end-to-end: 200, 302, 401, 403, 404, 500
- [ ] Slot `deny()` renders `denied.tsx`; parent and siblings unaffected
- [ ] Access gate shallowest-failure-wins (top-down ordering)
- [ ] URL canonicalization edge cases (double encode, `%2f`, `%00`, `..` traversal)
- [ ] CSRF protection
- [ ] `route.ts` method routing: 405 for missing methods, OPTIONS auto-response
- [ ] Metadata resolution and composition (title templates, shallow merge, error state)
- [ ] `ctx.req.headers` overlay: injected values visible in `access.ts`, components, actions; original request unchanged
- [ ] `redirect()` rejects absolute URLs; `redirectExternal()` enforces allow-list
- [ ] Security checklist from [`design/13-security.md`](design/13-security.md)

---

## Phase 2 — Developer Experience

Navigation, forms, observability, and dev tooling. Builds on the Phase 1 pipeline.

**Dependencies:** Phase 1 complete.

### 2a. Client Navigation

- [ ] `<Link>` intercepts clicks, fetches RSC payload, reconciles DOM without full reload
- [ ] `<Link>` renders as plain `<a>` without JavaScript (progressive enhancement)
- [ ] `<Link prefetch>` — opt-in, hover only, full server render
- [ ] `<Link>` scheme validation — rejects `javascript:`, `data:`, `vbscript:` at render time
- [x] Layout state preservation — React Flight reconciliation handles layout identity (no explicit wrapper needed)
  - [x] Layouts reconcile rather than remount on navigation (positional matching)
  - [x] Scroll position and client component state preserved across navigations within layout group
  - [x] Layouts unmount when navigating out of layout group
- [ ] Segment tree diffing via `X-Timber-State-Tree` header:
  - [ ] Client sends serialized router state tree on each navigation
  - [ ] Server skips sync layouts already in client tree
  - [ ] Async layouts always re-rendered
  - [ ] Pages always re-rendered
  - [ ] `middleware.ts` + `access.ts` always run regardless of what's skipped
  - [ ] Access failure → full denial response, state tree ignored
  - [ ] RSC partial payload: skipped segments simply absent, same wire format as full payload
- [ ] `router.refresh()` — explicit full re-render, no state tree sent
- [ ] Back/forward navigation:
  - [ ] RSC payloads stored in session history stack keyed by `(url, scrollY)`
  - [ ] `popstate` replays cached payload instantly — no server roundtrip
  - [ ] Cached history payloads persist for session duration (no expiry)
- [ ] Scroll restoration:
  - [ ] Forward navigation: scroll to top
  - [ ] Back/forward: restore `scrollY` via `scrollRestoration = 'manual'`
- [ ] Prefetch cache: 30-second lifetime; consumed entries move into history stack; expired entries dropped
- [ ] `useNavigationPending()` hook — returns `true` while navigation in flight

### 2b. Forms & Server Actions

- [ ] Forms work without JavaScript (progressive enhancement)
- [ ] `useActionState`, `useFormStatus`, `useOptimistic` from React for JS-enhanced forms
- [ ] `createActionClient` — typed middleware, `.schema()` validation (Zod/Valibot/ArkType), `ActionError`
- [ ] Raw `'use server'` exports remain as escape hatch
- [ ] `useActionState` from `@timber/app/client` typed to understand `createActionClient` result shape
- [ ] `revalidatePath(path)` — re-runs middleware + access + render, returns RSC payload in action response
  - [ ] If middleware short-circuits or auth fails during revalidation → action response includes redirect
- [ ] `revalidateTag(tag)` — invalidates `timber.cache` and `'use cache'` entries with matching tag

### 2c. Rendering Enhancements

- [x] `deferSuspenseFor` — page-level export to hold SSR stream; fast-resolving Suspense boundaries render inline
  - [x] SSR hold via `Promise.race(allReady, timeout)` in `ssr-render.ts`
  - [x] Collected from page/layout modules during RSC entry, passed via `NavContext`
- [ ] `RenderError` digest mechanism (may be Phase 1 if needed for error boundaries)

### 2d. Observability

- [ ] `instrumentation.ts` file convention (project root, not inside `app/`):
  - [ ] `register()` — async, awaited before first request; for SDK init and startup work
  - [ ] `onRequestError(error, request, context)` — called for every unhandled server error in any phase
  - [ ] `export const logger` — any `{ info, warn, error, debug }` object picked up automatically
- [ ] `traceId()` — importable from `@timber/app/server`:
  - [ ] Always set: OTEL trace ID when tracing active, `crypto.randomUUID().replace(/-/g,'')` otherwise
  - [ ] Always 32-char lowercase hex (`[0-9a-f]{32}`)
  - [ ] Stored in ALS store at request start
- [ ] Production log events (emitted to configured logger):
  - [ ] `info`: request completed (`method`, `path`, `status`, `durationMs`, `trace_id`)
  - [ ] `warn`: slow request (`slowRequestMs` threshold, default 3000ms)
  - [ ] `warn`: `staleWhileRevalidate` refetch failed
  - [ ] `warn`: `waitUntil()` promise rejected
  - [ ] `warn`: adapter does not support `waitUntil()` (once at startup)
  - [ ] `error`: unhandled error in middleware / render / proxy phases
  - [ ] `debug`: request received, middleware short-circuited, `timber.cache` MISS
- [ ] OTEL integration:
  - [ ] Depends on `@opentelemetry/api` only (vendor-neutral)
  - [ ] Root span: `http.server.request` (OTel HTTP semconv)
  - [ ] Child spans: `timber.proxy`, `timber.middleware`, `timber.access`, `timber.render`, `timber.render.suspense`, `timber.ssr`, `timber.action`, `timber.metadata`
  - [ ] `timber.cache` calls as span events (not child spans)
  - [ ] W3C `traceparent` propagated from incoming requests
  - [ ] OTEL context carried through timber.js ALS across RSC→SSR boundary
  - [ ] Log–trace correlation: inject `trace_id` + `span_id` into log entries automatically
- [ ] Dev logging (stderr, always on in dev, stripped from production builds):
  - [ ] Grouped indented tree mirroring execution structure
  - [ ] `[rsc]`/`[ssr]`/`[client]` environment labels
  - [ ] `timber.cache` / `React.cache` HIT/MISS per call site
  - [ ] Access check outcomes (PASS/DENY/REDIRECT)
  - [ ] Slow phase highlighting (`dev.slowPhaseMs`, default 200ms)
  - [ ] Slow slot warning: `"slot @admin resolved in 847ms and is not wrapped in <Suspense>"`
  - [ ] Server action execution trees
  - [ ] `TIMBER_DEV_QUIET=1` suppresses all dev output
  - [ ] `TIMBER_DEV_LOG=summary` reduces to one line per request

### 2e. Dev-Mode Warnings

- [ ] `<Suspense>` wrapping `{children}` in a layout (blocks the flush point)
- [ ] `cookies()`/`headers()` called during a static build pass
- [ ] `redirect()` called in slot `access.ts`
- [ ] `deny()`/`redirect()` called inside a post-flush `<Suspense>` boundary
- [ ] `"use cache"` component with request-specific props (cookies, headers, user identity)
- [ ] Slot resolved slower than `slowPhaseMs` without `<Suspense>` wrapper

### 2f. Phase 2 Testing

- [ ] `<Link>` navigation: DOM state preserved, scroll position preserved, client state preserved
- [ ] Back/forward: cached payload replayed, no server roundtrip
- [ ] Segment tree diffing: sync layouts skipped, async layouts re-rendered, pages always rendered
- [ ] `router.refresh()` forces full re-render
- [ ] `deferSuspenseFor` hold window: inline render when Suspense resolves in time, skeleton when not
- [ ] `createActionClient` schema validation rejects invalid input
- [ ] `revalidatePath` returns RSC payload; redirect in revalidation handled correctly
- [ ] `traceId()` accessible in all phases (proxy, middleware, access, render, action)
- [ ] Framework log events reach configured logger
- [ ] All dev-mode warnings fire in expected conditions and not in production

---

## Phase 3 — Type Safety

Typed routes, typed search params, typed `<Link>`. Requires a running Phase 1+2 to test against.

**Dependencies:** Phase 1 complete. Phase 2 navigation in place for `useQueryStates`.

### 3a. Route Map Codegen

- [ ] Build-time codegen generates a typed route map from the `app/` directory
- [ ] Route map includes: path pattern, params shape, search-params shape (if `search-params.ts` exists)
- [ ] `timber check` command: tsc + route map codegen validation + `search-params.ts` analyzability + unsupported config detection (no build)
- [ ] Route map regenerates on `middleware.ts`, `page.tsx`, `layout.tsx`, `search-params.ts` changes in dev

### 3b. Typed Params

- [ ] `params` typed per-route on `page.tsx`, `layout.tsx`, `middleware.ts`, `access.ts`
- [ ] Catch-all segments typed as `string[]`, optional catch-all as `string[] | undefined`
- [ ] `useParams()` return type narrowed per-route from route map

### 3c. `search-params.ts` System

- [ ] `createSearchParams` factory from `@timber/app/search-params`
- [ ] `fromSchema(zodSchema)` bridge — converts Zod/Valibot/ArkType schemas to `SearchParamCodec`
- [ ] `SearchParamCodec` protocol: `{ parse(raw: string | null): T, serialize(val: T): string | null }`
- [ ] `SearchParamsDefinition<T>` with `.extend()`, `.pick()`, `.serialize()`, `.href()`, `.toSearchParams()`, `.codecs`
- [ ] `urlKeys` aliasing: `{ category: 'cat' }` maps `?cat=shoes` → `{ category: 'shoes' }`
- [ ] Default values omitted from serialized URL
- [ ] Auto-parsing in `page.tsx`, `middleware.ts`, `access.ts` — framework runs `.parse()` before calling entry point
- [ ] `searchParams()` in other server contexts returns raw `URLSearchParams`
- [ ] Non-analyzable `search-params.ts` (dynamic default export, computed keys) → hard build error with diagnostic
- [ ] nuqs parsers are valid `SearchParamCodec` values natively

### 3d. Typed `<Link>`

- [ ] `<Link href="/route/pattern">` validated against known route patterns
- [ ] `<Link href="/products/[id]" params={{ id: 123 }}>` — typed params prop, framework interpolates URL
- [ ] `<Link href="/products" searchParams={{ category: 'shoes' }}>` — typed search params, serialized via route's definition
- [ ] Default values omitted from rendered `href`
- [ ] `params` prop and fully-resolved string `href` are mutually exclusive (type error)
- [ ] `searchParams` prop and inline query string are mutually exclusive (type error)

### 3e. `useQueryStates`

- [ ] `useQueryStates(definition)` from `@timber/app/client` — URL-synced state hook
- [ ] Wraps nuqs (peer dependency — developer installs `nuqs`)
- [ ] Default `shallow: false` — state changes trigger full server RSC navigation
- [ ] `scroll`, `history` options
- [ ] Integrates with `useNavigationPending()` during server navigation

### 3f. Phase 3 Testing

- [ ] Type-level tests: params typed correctly per-route, extra/missing params are type errors
- [ ] `search-params.ts` parsing: codec composition, `urlKeys`, default omission
- [ ] Non-analyzable `search-params.ts` produces build error with useful message
- [ ] `<Link>` typed params and searchParams: correct URL interpolation, type errors for invalid shapes
- [ ] `useQueryStates`: URL sync, `shallow: false` triggers server navigation

---

## Phase 4 — Caching

Cross-request data caching. The cache system is a full rewrite — do not adapt `cache-runtime.ts`.

**Dependencies:** Phase 1 (ALS, request pipeline). Phase 2 (`revalidateTag` integration with forms).

### 4a. `timber.cache`

- [ ] `timber.cache(fn, options)` — wraps async function with TTL, tags, key, stale-while-revalidate
- [ ] `options.ttl` — expiry in seconds
- [ ] `options.tags` — `string[]` or `((...args) => string[])` (function receives same args as wrapped fn)
- [ ] `options.key` — custom key function (default: SHA-256 of fn identity + normalized-JSON args)
- [ ] `options.staleWhileRevalidate` — serve stale immediately, background refetch, failed refetch continues serving stale
- [ ] Cache key security: SHA-256 hash, normalized object key ordering (prevents collision-based poisoning)
- [ ] Singleflight / request coalescing: concurrent misses for same key → single execution, all waiters share result
- [ ] `timber.cache.invalidate({ tag })` — invalidate by tag
- [ ] `timber.cache.invalidate({ key })` — direct key invalidation

### 4b. `"use cache"` Directive

- [ ] `'use cache'` directive on async server components or data functions
- [ ] `cacheLife(ttl)` — set TTL inside a `'use cache'` scope
- [ ] Cache key: props (for components), args (for functions)
- [ ] Same cache handler as `timber.cache` — two spellings, one system
- [ ] Same invalidation via `revalidateTag(tag)`
- [ ] Dev-mode warning when props appear request-specific (cookies, headers, user identity)

### 4c. Cache Handler Interface

- [ ] `CacheHandler` interface: `get(key)`, `set(key, value, opts)`, `invalidate(opts)`
- [ ] `MemoryCacheHandler` — default, in-process LRU
- [ ] `RedisCacheHandler` — shared across instances, distributed invalidation via shared store
- [ ] Pluggable via `cacheHandler` in `timber.config.ts`
- [ ] Distributed invalidation is the handler's responsibility (documented clearly)

### 4d. Phase 4 Testing

- [ ] Cache HIT / MISS / STALE paths
- [ ] Singleflight: concurrent misses produce one execution
- [ ] SWR: stale served immediately, background refetch completes, failed refetch continues serving stale
- [ ] Tag invalidation: entries with matching tag cleared
- [ ] Key invalidation: specific entry cleared
- [ ] `"use cache"` component: same cache handler, same invalidation
- [ ] `MemoryCacheHandler` isolation per instance
- [ ] `RedisCacheHandler` shared invalidation across instances

---

## Phase 5 — Pre-Rendering & Static Output

Static builds and the opt-in static shell optimization for server mode. Significant new build pipeline work.

**Dependencies:** Phases 1–4 complete. `timber.cache` must be in place before static shells can be invalidated.

### 5a. `static` Output Mode

- [ ] `output: 'static'` in `timber.config.ts` — full build-time render, no server
- [ ] `middleware.ts` and `access.ts` run at build time only
- [ ] `cookies()`/`headers()` calls in static mode → build error
- [ ] `generateMetadata` runs at build time in static mode
- [ ] Server actions extracted as separate API endpoints by adapter
- [ ] `revalidatePath()` in static mode requires two roundtrips (documented)
- [ ] `output: 'static', noClientJavascript: true`:
  - [ ] `'use client'` → hard build error
  - [ ] `'use server'` → hard build error
  - [ ] No React runtime in output
  - [ ] Pure `<a>` tags, no SPA navigation

### 5b. Static Shell Optimization (server mode, opt-in)

- [ ] `prerender.ts` per-route file convention: `generateParams`, `ttl`, `tags`
- [ ] Build-time pre-render pass for routes with `prerender.ts`
- [ ] `'use dynamic'` directive — component and subtree render per-request, excluded from pre-rendered shell
  - [ ] Directive in component function body (not a wrapper component)
  - [ ] `'use dynamic'` + `'use cache'` valid combination
- [ ] Request-time shell serving from cache
- [ ] Cache invalidation via `revalidateTag` purges pre-rendered shells
- [ ] `middleware.ts` + `access.ts` always run even when shell is cached

### 5c. Phase 5 Testing

- [ ] `static` mode: all pages render at build time, no server code in output
- [ ] `noClientJavascript` mode: `'use client'` and `'use server'` produce build errors
- [ ] Static mode `cookies()`/`headers()` produce build errors
- [ ] `'use dynamic'` boundaries: dynamic components render per-request, static shell unchanged
- [ ] Pre-rendered shell invalidated by `revalidateTag`

---

## Phase 6 — Shim Alignment

Bring `next/*` shims into the `@timber/app` namespace and audit compatibility with ecosystem libraries.

**Dependencies:** Phases 1–5. Shim behavior depends on a complete request pipeline.

- [ ] Audit all `next/*` shims against their Next.js equivalents: `next/link`, `next/image`, `next/font`, `next/navigation`, `next/headers`
- [ ] Update shim import paths from `next/*` → `@timber/app/*` (or keep as `next/*` aliases — decide)
- [ ] Test with ecosystem libraries: next-themes, nuqs, and any others identified during earlier phases
- [ ] Establish upstream tracking process: document which shims track Next.js closely vs. are intentional divergences
- [ ] Regression tests for each shim against ecosystem library behavior

---

## Adapters

Adapters can be developed in parallel with any phase once the Phase 1 pipeline is stable.

- [ ] Define `TimberPlatformAdapter` interface: `name`, `buildOutput(config, buildDir)`, `preview?(config, buildDir)`
- [ ] `@timber/app/adapters/cloudflare` — Cloudflare Workers/Pages (primary target, deep binding integration)
- [ ] `@timber/app/adapters/nitro` — Everything else: Node.js, Bun, Vercel, Netlify, AWS Lambda, Deno Deploy, Azure via `nitro({ preset })`

---

## CLI

Can be wired up after Phase 1 pipeline is runnable.

- [ ] `timber dev` — Vite dev server with HMR; middleware re-runs on file change
- [ ] `timber build` — RSC/SSR/client multi-environment build pipeline
- [ ] `timber preview` — serve production build locally via adapter `preview()` or built-in Node.js fallback
- [ ] `timber check` — tsc + route map codegen validation + `search-params.ts` analyzability + unsupported config detection (no build)
- [ ] All commands accept `--config <path>`

---

## Environment Variables

- [ ] `TIMBER_RUNTIME` — set by adapters at build time: `'node'` | `'bun'` | `'cloudflare'`
- [ ] `TIMBER_DEV_QUIET` — set to `1` to suppress all dev console output
- [ ] `TIMBER_DEV_LOG` — `'tree'` (default) | `'summary'`

---

## Open Questions

_(none — all resolved)_

---

## Resolved Design Decisions

See [`design/`](design/README.md) for full rationale. Summary of key decisions:

- **Package name** — `@timber/app`. Subpaths: `/server`, `/client`, `/cache`, `/search-params`, `/adapters/*`
- **Rendering model** — single `renderToReadableStream` call, one `React.cache` scope, unified element tree. Not parallel per-segment rendering.
- **Flush point** — held until `onShellReady`. Status code commits only when outcome is known.
- **`proxy.ts`** — global middleware with `next()`, runs before route matching
- **`middleware.ts`** — per-route, no `next()`, runs after route matching, before render
- **`access.ts`** — runs inside React tree via `AccessGate`, shares `React.cache` with layouts/pages
- **`MiddlewareContext`** — one-arg: `middleware(ctx)`. `{ req: Request, requestHeaders: Headers, headers: Headers, params, searchParams }`
- **`RouteContext`** — one-arg: `GET(ctx)`. `{ req: Request, params, searchParams: URLSearchParams, headers: Headers }`
- **`AccessContext`** — single type for both segments and slots. `{ params, searchParams }`. `cookies()`/`headers()` imported from `@timber/app/server`
- **`requestHeaders`** — mutable Headers overlay, original request never mutated, visible downstream via `headers()`
- **`deny()`** — one function, context-dependent: HTTP status in segments, graceful degradation in slots
- **`denied.tsx` props** — `{ slot: string, dangerouslyPassData?: unknown }`
- **`dangerouslyPassData`** — prop name signals RSC→client boundary crossing. Used in 4xx files and `denied.tsx`. Data from `deny(status, data)`
- **Status-code files** — `{status}.tsx`, `4xx.tsx`, `5xx.tsx`, `error.tsx` with fallback chain
- **No ISR** — CDN caching via explicit `Cache-Control` in `middleware.ts`
- **No `loading.tsx`** — framework never auto-inserts Suspense boundaries
- **`timber.cache` tags** — `string[] | ((...args: Parameters<Fn>) => string[])`
- **`'use cache'` + `timber.cache`** — two spellings, one cache handler, same invalidation
- **`search-params.ts`** — non-analyzable is a hard build error, types never fall back to `unknown`
- **`useQueryStates`** — wraps nuqs (peer dep), `shallow: false` default triggers server navigation
- **Back/forward** — cached RSC payload replay, session-lived, no server roundtrip
- **Segment tree diffing** — sync layouts skipped when mounted, async always re-rendered, pages always re-rendered, access always runs
- **Layout state preservation** — React Flight reconciliation suffices, no explicit wrapper needed
- **`traceId()`** — always set, always 32-char hex, OTEL trace ID or UUID fallback
- **OTEL** — `@opentelemetry/api` only in framework; developer initializes SDK in `register()`
- **CSRF** — auto-derived from `Host` header; `allowedOrigins` in config for multi-origin
- **Progressive enhancement** — forms work without JavaScript
- **`'use dynamic'`** — component body directive, not a wrapper component. Deferred to Phase 5.
- **`handler.ts` → `middleware.ts`** — renamed throughout; `HandlerContext` → `MiddlewareContext`
