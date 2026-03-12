# Routing & Middleware

## `proxy.ts` — Global Middleware

`app/proxy.ts` runs on every request before route matching. It handles infrastructure concerns that span all routes — CORS, rate limiting, security headers, logging.

Two forms are supported:

```typescript
// Array form — ordered, each item has the same (req, next) signature
export default [
  cors({ origins: ['https://example.com'] }),
  rateLimit({ requests: 100, window: '1m' }),
  securityHeaders(),
];

// Function form — full control
export default function proxy(req: Request, next: () => Promise<Response>) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  return next();
}
```

**Array form details:** Each item in the array is a middleware function with the signature `(req: Request, next: () => Promise<Response>) => Promise<Response>`. They compose left-to-right: the first item's `next()` calls the second item, and so on, with the final item's `next()` proceeding to route matching and rendering. Any item can short-circuit by returning a `Response` instead of calling `next()`. Factory functions like `cors()` and `rateLimit()` return middleware functions with this signature.

`proxy.ts` runs before route matching. `middleware.ts` runs after route matching. The distinction maps to what these things do: `proxy.ts` doesn't know which route it's on; `middleware.ts` is specific to a single matched route.

**The asymmetry is intentional:** `proxy.ts` has `next()` — it can wrap the entire request lifecycle (set timing headers, catch errors, log response codes). `middleware.ts` does NOT have `next()` — it is a pre-render gate that either short-circuits or passes through. Middleware cannot observe or modify the render result. If you need to wrap rendering (timing, response transformation), that belongs in `proxy.ts`.

**Error handling:** If `proxy.ts` throws an uncaught error (or `next()` throws and proxy.ts doesn't catch it), the framework returns a bare HTTP 500 with no body and logs the error server-side. There is no configurable global error handler — `proxy.ts` itself is the place to catch and handle errors if custom error responses are needed.

---

## URL Canonicalization & Security

The request URL is canonicalized exactly once, at the request boundary, before `proxy.ts` or route matching sees it. Every layer — `proxy.ts`, `middleware.ts`, `access.ts`, and components — receives the same canonical URL. No re-decoding occurs at any later stage.

### Canonicalization Rules

1. **Single decode.** Percent-encoded sequences are decoded once. Double-encoded input (`%2561` → `%61`) stays as `%61` after the single decode — it is not decoded again to `a`. This prevents the class of middleware-bypass attacks where different pipeline stages see different decoded values.

2. **Path normalization.** Before route matching:
   - `//` collapses to `/`
   - `..` segments are resolved (and rejected if they escape the root)
   - Trailing slashes are stripped (configurable)

3. **Encoded separators rejected.** `%2f` (encoded `/`) and `%5c` (encoded `\`) in path segments produce a 400 response. These are used in path confusion attacks where middleware and routers disagree on segment boundaries.

4. **Null bytes rejected.** `%00` in the path produces a 400 response.

5. **Backslash normalization.** `\` in paths is not treated as a path separator. `/\evil.com` does not become `//evil.com`.

### Why `proxy.ts` Uses Functions, Not Regex Matchers

`proxy.ts` is function-based by design. Regex-based route matchers are a common source of bypass vulnerabilities — improperly escaped special characters, Unicode edge cases, and alternation-based ReDoS. If route-conditional logic is needed in `proxy.ts`, use standard string comparison on the already-canonical path.

### Framework Endpoints Run Through `proxy.ts`

All framework-internal endpoints (RSC payload delivery, etc.) are subject to `proxy.ts`. No endpoint bypasses the middleware pipeline.

### `<Link>` Scheme Validation

`<Link>` rejects dangerous URL schemes at render time. Only relative URLs and `http:`/`https:` schemes are allowed. `javascript:`, `data:`, and `vbscript:` schemes produce a dev-mode warning and render as an inert element.

---

## Config-Level Redirects and Rewrites

`timber.config.ts` supports declarative `redirects` and `rewrites` arrays. These are evaluated after URL canonicalization and before route matching — they run before middleware, access checks, and rendering.

```typescript
// timber.config.ts
export default {
  redirects: [
    { source: '/old/:slug', destination: '/new/:slug', permanent: true },
    { source: '/legacy', destination: '/modern' },
  ],
  rewrites: [{ source: '/api/v1/:path*', destination: '/api/v2/:path*' }],
};
```

**Patterns:** `:param` matches a single segment, `:param*` matches one or more segments (catch-all). Static segments are matched literally.

**Redirects** return an HTTP redirect response (307 temporary or 308 permanent). The request never reaches route matching.

**Rewrites** transparently change the pathname for route matching. The client URL does not change.

**Execution order:** `proxy.ts` → canonicalize → **redirects/rewrites** → route match → middleware → access → render.

For complex redirect logic (header-based conditions, async checks, database lookups), use `middleware.ts` or `proxy.ts` instead. Config redirects are for simple, declarative cases.

---

## Route Matching

After URL canonicalization (and any config-level rewrites), the canonical pathname is matched against the segment tree built by the route scanner. The route matcher (`server/route-matcher.ts`) walks the tree depth-first with the following priority at each level:

1. **Static segments** — exact match on directory name
2. **Route groups** — transparent (don't consume URL segments), children checked recursively
3. **Dynamic segments** (`[param]`) — match any single segment, extract param value
4. **Catch-all segments** (`[...param]`) — match one or more remaining segments
5. **Optional catch-all segments** (`[[...param]]`) — match zero or more remaining segments

A match succeeds when all URL segments are consumed and the leaf segment has a `page` or `route` file. The result includes the full segment chain (root → leaf) and extracted params.

**Params as Promise:** Following the React 19+ convention (and Next.js 15+), `params` is passed to page components and `generateMetadata` as a `Promise<Record<string, string>>` rather than a plain object. Components `await` the params promise to access values.

**No-match signal:** When no route matches, the pipeline returns `404` with an `X-Timber-No-Match` header. This distinguishes "no route found" from a deliberate `deny(404)` thrown during rendering. In dev mode, only no-match 404s pass through to Vite's fallback; route-level 404s are served directly.

---

## Parallel Routes

Parallel routes render multiple page components simultaneously within a single layout using named slots. A slot is a directory prefixed with `@` (e.g., `@sidebar`, `@modal`). Slots are passed as named props to their parent layout alongside `children`.

```
app/
  dashboard/
    layout.tsx           ← receives { children, sidebar }
    page.tsx             ← renders as children
    @sidebar/
      page.tsx           ← renders as sidebar prop
      default.tsx        ← fallback when no match
      projects/
        page.tsx         ← sidebar content for /dashboard/projects
```

**Slot resolution:** Each slot independently matches the current URL against its sub-tree. If a slot has a matching page for the current URL, it renders that page. Otherwise, it renders `default.tsx`. If neither exists, the slot renders nothing (`null`).

**Slot-level features:** Each slot gets independent error boundaries (from `error.tsx` and status files along the slot's matched segment chain), layouts, and access gates. This enables each slot to handle errors and auth independently.

**Slots don't add URL depth.** A slot at `/dashboard/@sidebar` has the same `urlPath` as `/dashboard`. Its children match the URL segments that follow `/dashboard`.

---

## Intercepting Routes

Intercepting routes conditionally render a different page component on **soft navigation** (client-side `<Link>` clicks) while preserving the normal page on **hard navigation** (direct URL access, page reload). This enables the modal pattern: clicking a photo link shows a modal overlay, but navigating directly to the same URL shows the full photo page.

### Directory Conventions

Intercepting routes are defined by directory names that start with a marker indicating how many levels up to resolve the intercepted URL:

| Marker     | Meaning       | Example                                                                     |
| ---------- | ------------- | --------------------------------------------------------------------------- |
| `(.)`      | Same level    | `@modal/(.)photo/[id]/page.tsx` intercepts `/feed/photo/[id]` from `/feed`  |
| `(..)`     | One level up  | `@modal/(..)photo/[id]/page.tsx` intercepts `/photo/[id]` from one level up |
| `(...)`    | Root level    | `@modal/(...)photo/[id]/page.tsx` intercepts `/photo/[id]` from anywhere    |
| `(..)(..)` | Two levels up | `@modal/(..)(..)photo/page.tsx` intercepts from two levels up               |

### Example: Photo Modal

```
app/
  feed/
    layout.tsx           ← receives { children, modal }
    page.tsx             ← feed page
    @modal/
      default.tsx        ← renders nothing normally (export default () => null)
      (.)photo/
        [id]/
          page.tsx       ← modal photo view (soft nav only)
    photo/
      [id]/
        page.tsx         ← full photo page (hard nav)
```

- **Soft navigation** (`<Link href="/feed/photo/123">`): The `@modal` slot renders `(.)photo/[id]/page.tsx` as a modal overlay. The feed page stays visible behind it.
- **Hard navigation** (direct URL `/feed/photo/123`): No interception. The normal route `/feed/photo/[id]/page.tsx` renders.

### How It Works

1. **Build time:** The route scanner identifies intercepting directories and the routing plugin computes `interceptionRewrites` — conditional rewrite rules mapping intercepted URL patterns to intercepting prefixes.

2. **Soft navigation:** The client sends an `X-Timber-URL` header with the current pathname (where the user is navigating FROM). The server checks if any interception rewrite matches both the target URL and the source URL prefix.

3. **Re-match:** When interception applies, the server re-matches the **source** URL (the intercepting route's parent) instead of the target URL. The slot resolver then finds the intercepting child in the slot and renders its page.

4. **Hard navigation:** No `X-Timber-URL` header is sent. No rewrite matches. The normal route renders.

### Cache Control

Interception responses include `Vary: X-Timber-URL` to ensure CDNs cache soft-navigation and hard-navigation responses separately for the same URL.

---

## `middleware.ts`

Each route can have one `middleware.ts` — co-located with the route's `page.tsx`. Only the leaf route's middleware runs. There is no middleware chain and no inheritance. If you need shared infrastructure across routes (CORS, rate limiting), that belongs in `proxy.ts`.

Middleware runs **before rendering starts** (blocking). It can set response headers, inject request headers, warm caches, perform lightweight auth checks, or short-circuit the request.

```typescript
// app/dashboard/settings/middleware.ts
export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  ctx.headers.set('Cache-Control', 'private, max-age=0');
  // return nothing → continue to access checks + render
}
```

The middleware function receives a single context object:

```typescript
interface MiddlewareContext {
  req: Request; // the original incoming request (immutable)
  requestHeaders: Headers; // mutable — visible downstream via headers()
  headers: Headers; // response headers — applied at flush time
  params: Record<string, string>;
  searchParams: T; // parsed & typed when search-params.ts exists; URLSearchParams otherwise
}
```

`ctx.params` is always fully resolved when middleware runs. Route matching extracts all dynamic params (including catch-all and optional segments) before invoking middleware — there is no deferred or partial params object. Middleware for `/dashboard/projects/[projectId]` always has `ctx.params.projectId` as a non-null string.

When a route has a co-located `search-params.ts`, the framework parses the raw `URLSearchParams` through the definition before calling middleware. `ctx.searchParams` is the typed, parsed object — no manual parsing required. When no definition exists, `ctx.searchParams` is the raw `URLSearchParams` (backward compatible). Build-time codegen types the generic per-route.

### Response Headers (`ctx.headers`)

`ctx.headers` provides read/write access to **response** headers for the current request. It is a standard web `Headers` object:

```typescript
ctx.headers.get('Cache-Control'); // read a header
ctx.headers.set('Cache-Control', 'private, max-age=0'); // set key/value
ctx.headers.set('Vary', 'Accept'); // set another
```

The framework reads `ctx.headers` at flush time and applies them to the final response. Headers set by `proxy.ts` are also included.

### Request Header Injection (`ctx.requestHeaders`)

`ctx.requestHeaders` provides write access to **request** headers — the headers that server components, `access.ts`, and server actions read via `headers()`. This is the mechanism for passing per-request context (derived locale, feature flags, resolved tenant) into the component tree without prop-drilling.

```typescript
// app/[locale]/dashboard/middleware.ts
export default async function middleware(ctx: MiddlewareContext) {
  // Derive locale from route param and inject for components to read
  ctx.requestHeaders.set('X-Locale', ctx.params.locale);

  // Inject a feature flag resolved from a remote config service
  const flags = await getFeatureFlags(ctx.req);
  ctx.requestHeaders.set('X-Feature-Flags', JSON.stringify(flags));
}
```

```typescript
// app/[locale]/dashboard/page.tsx
import { headers } from '@timber/app/server'

export default async function DashboardPage() {
  const locale = headers().get('X-Locale')  // 'en' — set by middleware
  return <Dashboard locale={locale} />
}
```

**Visibility:** Request headers injected by `middleware.ts` are visible to everything downstream in the pipeline — `access.ts`, all server components, server actions, and `route.ts` handlers. They are NOT visible to `proxy.ts`, which already ran before route matching. The original incoming request headers are never mutated — the framework maintains an overlay that is merged with the originals when `headers()` is called.

**`ctx.headers` vs `ctx.requestHeaders`:** These are two distinct APIs with different directions:

- `ctx.headers` — **response** headers (what you send back to the client)
- `ctx.requestHeaders` — **request** headers (what downstream server code reads via `headers()`)

### Lightweight Auth

Middleware can perform lightweight auth checks — validating a token from a request header, checking a session cookie, rejecting unauthenticated API requests — before the React tree. When access should be denied, return a `Response` directly to short-circuit:

```typescript
// app/api/internal/middleware.ts
import { cookies } from '@timber/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  const token = ctx.req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token || !(await validateToken(token))) {
    return new Response(null, { status: 401 });
  }
}
```

**When to use `middleware.ts` vs `access.ts` for auth:**

|               | `middleware.ts`                                                    | `access.ts`                                          |
| ------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| Runs          | Before React tree                                                  | Inside React tree (via `AccessGate`)                 |
| `React.cache` | Not active                                                         | Active — shares scope with layouts/page              |
| Best for      | Lightweight token checks, API route auth, rejecting requests early | Segment auth that shares data with layouts and pages |
| Denial        | Return `new Response(null, { status: 401 })`                       | Call `deny()` or `redirect()`                        |

For page routes where auth needs to share data with the layout (e.g., `requireUser()` called in both `access.ts` and the layout), `access.ts` is the right place — `React.cache` deduplicates. For API routes or lightweight token validation that doesn't need `React.cache`, `middleware.ts` is sufficient.

A route that throws produces an HTTP 500. Middleware errors are request-level — they happen before rendering, so there is no React error boundary to catch them.

If middleware returns a Response (redirect, error), rendering never starts. The response is sent directly.

### What Middleware Is and Is Not

**Middleware is for:**

- Request-level redirects — canonical URLs, feature flags, A/B routing
- Setting response headers — `Cache-Control`, `Vary`, custom headers
- Injecting request headers — locale, feature flags, tenant context for downstream components
- Short-circuiting with any HTTP response
- Lightweight auth — token validation, early rejection before rendering

**Middleware is not for:**

- Segment auth that shares data with layouts — use `access.ts` (see [Authorization](04-authorization.md))
- Loading data for components to consume
- Shared infrastructure across routes — that belongs in `proxy.ts`
- Anything that belongs in the component tree

Data belongs in components, co-located with where it's used. Segment auth belongs in `access.ts`, co-located with the segment being protected. Shared request-level concerns (CORS, security headers, logging) belong in `proxy.ts`.

### Middleware and `route.ts` API Endpoints

`middleware.ts` wraps both page routes and `route.ts` API endpoints. A `middleware.ts` next to a `route.ts` runs before the API handler, same as it runs before page rendering.

### Cache Warming (Performance Optimization)

React renders a single tree top-down: a parent async server component must resolve before React evaluates `{children}`. For most apps where the database is nearby, this waterfall is negligible — Rails and PHP had this for decades. When profiling shows a waterfall that matters, middleware.ts can eliminate it by firing prefetches at t=0:

```typescript
// app/dashboard/projects/[projectId]/middleware.ts
export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  ctx.headers.set('Cache-Control', 'private, no-cache');

  // Optional: prefetch to eliminate data waterfall
  void requireUser();
  void getOrg();
  void getProject(ctx.params.projectId);
}
```

```
Without prefetching (waterfall — often fine):
  AccessGate(auth): requireUser()    50ms
  AuthLayout: getOrg()               40ms  (starts at t=50ms)
  Page: getProject()                 45ms  (starts at t=90ms)
  TOTAL:                             135ms → shell ready at t=135ms

With middleware prefetching (optimization):
  middleware fires all at t=0:
    void requireUser()               50ms  ┐
    void getOrg()                    40ms  ├── max = 50ms
    void getProject(id)              45ms  ┘
  Render at t≈0:
    All calls → timber.cache HIT
  TOTAL:                             shell ready at t≈50ms
```

The prefetched functions use `timber.cache`, which populates the cross-request cache handler. When the render pass starts, components calling the same `timber.cache`-wrapped functions check the cache handler first — the data is already resolved or close to it.

**This is an optimization, not a required pattern.** Without middleware.ts prefetching, nested async layouts waterfall naturally — and that's often perfectly acceptable. Profile first, optimize second.

**`AccessGate` is a secondary warming point.** Even without middleware.ts, auth data fetched in a parent `AccessGate` (e.g., `requireUser()`) is available to child `AccessGate` calls and layouts via `React.cache` — the parent runs first in the top-down render. Shared auth data is always deduplicated.

---

## `<Link>` and Navigation

Client-side navigation intercepts `<Link>` clicks, fetches the RSC payload for the new route (which runs the handler + access checks + render on the server), and reconciles the DOM. The URL updates, the browser history stack updates, the page updates — no full reload.

**Middleware and all access checks run on every RSC navigation.** `middleware.ts` and `access.ts` do not distinguish between initial page loads and RSC navigations — both are full request cycles. Auth is enforced by `access.ts` on every navigation (see [Authorization](04-authorization.md)), so a session that expires between navigations produces a correct redirect, not a stale page.

Without JavaScript, `<Link>` renders as a standard `<a>` tag. Clicking it triggers a full page load through the waterfall. The experience is slower but correct.

### Prefetching

Opt-in, hover only. No automatic viewport intersection prefetching. Each prefetch triggers a full server render — the framework does not hide this cost by making it automatic.

```tsx
<Link href="/dashboard" prefetch>
  Dashboard
</Link>
```

### Typed `params` and `searchParams` on `<Link>`

`<Link>` type-checks its `href` against the generated route map. For dynamic routes and routes with `search-params.ts`, `<Link>` accepts typed `params` and `searchParams` props so you don't have to build URL strings manually:

```tsx
// Traditional string href — still works, type-checked
<Link href="/products/123?cat=shoes&page=2">Product 123</Link>

// Route pattern href with typed params — framework interpolates the URL
<Link href="/products/[id]" params={{ id: 123 }}>Product 123</Link>
// renders href="/products/123"

// params + searchParams together
<Link href="/products/[id]" params={{ id: 123 }} searchParams={{ tab: 'reviews' }}>
  Reviews
</Link>
// renders href="/products/123?tab=reviews"

// searchParams on a static route
<Link href="/products" searchParams={{ category: 'shoes', page: 2 }}>Shoes</Link>
// renders href="/products?cat=shoes&page=2" (category aliased to 'cat')

// searchParams uses property names, not URL keys
<Link href="/products" searchParams={{ category: 'shoes' }}>Shoes</Link>
// renders href="/products?cat=shoes" (page omitted — default)
```

All typing is derived from the generated route map at build/dev time — no runtime validation overhead.

**`params` prop:**

- `href` accepts route patterns with `[param]` segments — e.g., `/products/[id]`, `/blog/[...slug]`
- `params` is typed per-route from the route map. For `/products/[id]`, params is `{ id: string | number }`
- Values are automatically stringified — passing `{ id: 123 }` produces `/products/123`
- TypeScript validates the params shape against the route pattern. Missing or extra params are type errors
- `params` prop and a fully-resolved string `href` (no `[param]` segments) are mutually exclusive

**`searchParams` prop:**

- The framework serializes the values using the route's `search-params.ts` definition (respecting `urlKeys` and default-omission)
- TypeScript validates the object against the route's searchParams type
- Default values are omitted from the rendered URL
- The `searchParams` prop and inline query string in `href` are mutually exclusive — providing both is a TypeScript error

### Navigation Loading State

The `useNavigationPending()` hook returns `true` while a client-side navigation is in flight. Use it for global progress indicators or per-link spinner states.

```tsx
function NavLink({ href, children }) {
  const pending = useNavigationPending();
  return (
    <a href={href} aria-busy={pending}>
      {children}
    </a>
  );
}
```

This is a first-class framework primitive, not a userland solution. The alternative — wrapping `{children}` in a layout with `<Suspense>` — surrenders HTTP correctness and is actively warned against.

---

## Layout State Preservation

Client-side navigation fetches a fresh RSC payload for the full route on every navigation. React Flight's built-in reconciliation preserves layout state naturally — no explicit client component wrapper is needed.

### Why No Wrapper Is Needed

When `reactRoot.render(newRscPayload)` is called during client-side navigation, React reconciles the deserialized RSC tree against the existing fiber tree. Server component output is inlined in the RSC payload as DOM elements and client component references. Since layout output structures are identical across navigations within the same layout group (only the `{children}` slot changes), React naturally preserves:

- **DOM nodes** — same element types at the same positions reconcile rather than remount, preserving scroll positions
- **Client component state** — `useState`, refs, and other state in client components within layouts survive navigation, because the client component module references in the RSC payload are stable across navigations
- **Layout structure** — the nested layout hierarchy provides inherent positional identity; React matches layouts by their position in the tree

```
/dashboard/settings → /dashboard/team

  <RootLayout>                    ← same output structure, reconciled
    <DashboardLayout>             ← same output structure, reconciled
      <TeamPage />                ← new, replaces SettingsPage
    </DashboardLayout>
  </RootLayout>

/dashboard/team → /profile

  <RootLayout>                    ← same output structure, reconciled
    <ProfilePage />               ← new
                                  ← DashboardLayout unmounts (not in tree)
```

### What About Segment Tree Diffing?

Segment tree diffing (see below) sends partial RSC payloads that skip mounted layouts. This requires the **client-side segment router** to cache mounted segments and compose them with incoming partial payloads — similar to Next.js's `LayoutRouter`/`InnerLayoutRouter` pattern. The router handles segment identity and caching; no per-layout wrapper component is needed.

The framework still computes `layoutSegmentPaths` for each route (the URL path prefix at each layout level). This metadata is used by the segment router to identify which segments to cache, skip, and compose during partial payload reconciliation.

---

## Segment Tree Diffing on Navigation

React Flight reconciliation preserves client state — but the server still renders every layout on every navigation. This is wasteful when the client already has a perfectly good layout mounted. The optimization: **the client sends its current router state tree, and the server only renders the diff.**

### Caching Rules

- **Pages** — cache lifetime = 0. Always re-rendered on the server, every navigation.
- **Layouts** — sync layouts are cached as long as they remain mounted. Async layouts are always re-rendered. Unmounting discards them. No TTL.
- **`access.ts`** — always runs, every navigation, regardless of what's cached.

### The Router State Tree

The client maintains a lightweight representation of its mounted segment hierarchy:

```typescript
// Conceptual shape — not necessarily the wire format
type RouterStateNode = [
  segmentPath: string, // e.g., "/dashboard"
  children: RouterStateNode[], // child segments + page
  parallelSlots?: Record<string, RouterStateNode>,
];
```

On client-side navigation, the client serializes this tree and sends it as a header:

```
X-Timber-State-Tree: <serialized tree>
```

The server knows at build time which layouts are async. Combined with the client's state tree, this is all that's needed to decide what to skip.

### Server Diffing Rules

For each segment in the target route's chain, the server decides: render or skip?

| Segment type                 | In client tree?                | Async? | Decision                                    |
| ---------------------------- | ------------------------------ | ------ | ------------------------------------------- |
| Layout (sync)                | Yes (same path, still mounted) | No     | **SKIP** — client has it                    |
| Layout (async)               | Yes (same path, still mounted) | Yes    | **RENDER** — async layouts always re-render |
| Layout                       | No (new layout entering tree)  | —      | **RENDER**                                  |
| Page                         | Any                            | —      | **ALWAYS RENDER**                           |
| Parallel slot layout (sync)  | Yes (same slot, same path)     | No     | **SKIP**                                    |
| Parallel slot layout (async) | Yes (same slot, same path)     | Yes    | **RENDER**                                  |
| Parallel slot layout         | No                             | —      | **RENDER**                                  |

The rule is simple: **async layouts always re-render, sync layouts are skipped when mounted.** This means any layout that fetches data, reads cookies, or accesses params will always produce fresh output on every navigation. Sync layouts that are purely presentational (accepting `children` and rendering static chrome) are safely cached.

```
Client navigates: /dashboard/settings → /dashboard/team
Client sends state tree: ["/", ["/dashboard", ["/dashboard/settings"]]]

Server diffs against target: ["/", ["/dashboard", ["/dashboard/team"]]]

  "/" layout          → in client tree → SKIP
  "/dashboard" layout → in client tree → SKIP
  "/dashboard/team"   → page           → ALWAYS RENDER

Server renders only the page segment. Sends partial RSC payload.
```

**Cross-layout-group navigation:**

```
/dashboard/team → /profile

Client sends: ["/", ["/dashboard", ["/dashboard/team"]]]
Target tree:  ["/", ["/profile"]]

  "/" layout     → in client tree → SKIP
  "/dashboard"   → not in target  → will unmount on client (no action needed)
  "/profile"     → page           → ALWAYS RENDER

Server renders only <ProfilePage />.
Client: Root layout stays mounted, children slot updated.
        Dashboard layout unmounts (absent from new tree).
```

**Access always runs.** All `access.ts` files in the segment chain execute on every navigation — regardless of which layouts are skipped. If any access check fails (`deny()` or `redirect()`), the mounted state tree is **ignored** and the server renders the full denial response from scratch. Auth changes always produce correct output.

### When the State Tree Is Not Sent

- Initial page load (SSR) — no tree, full render
- `revalidatePath()` responses — full render regardless of tree
- `router.refresh()` — explicit full re-render (see below)
- Prefetch responses — full render (no client tree context during prefetch)

### `router.refresh()` — Escape Hatch

When the developer knows layout data has changed and wants a fresh render:

```tsx
const router = useRouter();
router.refresh(); // re-fetches full tree, no state tree header sent
```

Use cases: after a server action that changes data displayed in a layout (user updated their name, role changed), or when `revalidatePath()` isn't appropriate.

### Staleness Model

**Async layouts** are always fresh — they re-render on every navigation. No staleness concern.

**Sync layouts** accept staleness by design. A mounted sync layout shows its last-rendered output until:

- The user navigates out of the layout group (layout unmounts → discarded)
- A `revalidatePath()` from a server action triggers a full re-render
- The developer calls `router.refresh()`
- A full page reload (browser refresh)

Pages are always fresh. Every navigation re-renders the page on the server.

### Interaction with Other Features

- **Segment router** — the client-side segment router caches mounted layouts. When a layout is skipped, the router keeps its cached output — no reconciliation work at all.
- **Rendering** — only non-skipped segments are included in the element tree.
- **`middleware.ts`** — still runs every navigation. Not affected.
- **Prefetching** — `<Link prefetch>` renders the full tree (no state tree context). Prefetch responses include all segments.

---

## Page Extensions

Route discovery recognizes files by extension. The default set is `tsx`, `ts`, `jsx`, `js`. This is configurable:

```typescript
// timber.config.ts
export default {
  pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx', 'md'],
};
```

When `mdx` or `md` is included, those files are valid route segments — a `page.mdx` is a page, a `layout.mdx` is a layout. MDX files are server components by default (RSC). This means you can write content-heavy routes as MDX and they render on the server with zero client JS:

```
app/
  docs/
    getting-started/
      page.mdx          ← renders as RSC, no client bundle
    api-reference/
      page.mdx
    layout.tsx           ← shared docs layout
```

MDX components can import and use other components, including client components. The MDX file itself stays on the server — only explicitly `'use client'` components ship to the browser.

All route conventions apply uniformly regardless of extension: `page.*`, `layout.*`, `access.*`, `handler.*`, `route.*`, `default.*`. The extension list controls which files are recognized, not how they behave.

---

## `route.ts` — API Endpoints

API endpoints are defined by `route.ts` files co-located with route segments. They export named functions for each HTTP method they handle. No React rendering is involved — API endpoints are pure request/response.

```typescript
// app/api/users/route.ts
import type { RouteContext } from '@timber/app/server';

export async function GET(ctx: RouteContext) {
  const users = await db.users.findAll();
  return Response.json(users);
}

export async function POST(ctx: RouteContext) {
  const body = await ctx.req.json();
  const user = await db.users.create(body);
  return Response.json(user, { status: 201 });
}
```

### Supported Methods

Export named functions: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`. Only exported methods are allowed — a `POST` to a route that only exports `GET` returns 405.

### `OPTIONS` Auto-Response

If `OPTIONS` is not explicitly exported, the framework generates an automatic response with an `Allow` header listing the exported methods:

```
OPTIONS /api/users
→ 204 No Content
→ Allow: GET, POST, OPTIONS
```

### Pipeline Integration

API routes run through the same pipeline as page routes:

1. **`proxy.ts` runs first** — CORS, security headers, rate limiting apply to API routes. No exceptions.
2. **`middleware.ts` runs before the API handler** — a `middleware.ts` co-located with `route.ts` runs before the exported method handler. It can set headers, short-circuit with a redirect, or warm caches. Lightweight auth checks (token validation, early rejection) are appropriate here.
3. **`access.ts` runs for API routes** — if the route segment has an `access.ts`, it executes before the API handler. Auth is enforced the same way as for page routes. Since there is no React tree for API routes, `access.ts` runs standalone (not via `AccessGate`). `React.cache` is not active — use `timber.cache` for deduplication.
4. **The exported method handler runs** — receives a `RouteContext` with `req`, `params`, `searchParams`, and `headers`.

```
Request arrives
  → proxy.ts
  → Route matching → route.ts identified
  → middleware.ts runs (if exists)
  → access.ts runs (if exists in segment chain)
  → Exported method handler runs
  → Response returned
```

### `RouteContext`

```typescript
interface RouteContext {
  req: Request; // the original incoming request
  params: Record<string, string>;
  searchParams: URLSearchParams; // raw; auto-parsed when search-params.ts exists
  headers: Headers; // response headers — applied to the final response
}
```

### Streaming Responses

API endpoints can return streaming responses for Server-Sent Events (SSE):

```typescript
export async function GET(ctx: RouteContext) {
  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(() => {
        controller.enqueue(`data: ${JSON.stringify({ time: Date.now() })}\n\n`);
      }, 1000);
      ctx.req.signal.addEventListener('abort', () => clearInterval(interval));
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

### What API Routes Are Not

- **GraphQL resolvers.** Mount a GraphQL server via a catch-all `route.ts` if needed.
- **File upload handlers.** API routes receive the full `Request` — file upload handling is the developer's responsibility. The framework enforces configurable body size limits (see [Forms — Security](08-forms-and-actions.md#formdata-limits)).

### Real-Time: Out of Scope

**WebSocket endpoints** are explicitly excluded from timber.js's scope. The framework handles HTTP request/response cycles. For real-time features:

- **SSE (Server-Sent Events)** — supported via streaming `route.ts` responses (see above). Good for one-way server-to-client updates.
- **WebSockets** — use a separate service (Socket.io, Ably, Pusher, etc.) or platform-level WebSocket support (Cloudflare Durable Objects, etc.). timber.js does not handle WebSocket upgrade.
- **Long polling** — supported naturally via `route.ts` API endpoints.

This is a deliberate scope boundary. HTTP request/response is timber.js's domain. Persistent bidirectional connections are a different problem with different infrastructure requirements.

### `route.ts` vs `page.tsx`

A route segment cannot have both `route.ts` and `page.tsx`. They are mutually exclusive — a URL is either an API endpoint or a rendered page. Build error if both exist.

---

## i18n / Locale Routing

timber.js does not include a framework-level i18n runtime (message catalogs, pluralization, formatting). Locale routing — how the URL maps to a locale — is handled through existing primitives.

### Path-Prefix Locales via Route Groups

The recommended pattern is route groups per locale:

```
app/
  (en)/
    layout.tsx           ← English layout
    page.tsx
    products/page.tsx
  (fr)/
    layout.tsx           ← French layout
    page.tsx
    products/page.tsx
  proxy.ts               ← locale detection and redirect
```

Route groups do not add URL depth. `/en/products` and `/fr/products` are distinct routes with their own layouts, pages, and `access.ts` files.

### Locale Detection

Locale detection belongs in `proxy.ts` or `middleware.ts`:

```typescript
// app/proxy.ts
export default async function proxy(req: Request, next: () => Promise<Response>) {
  const url = new URL(req.url);
  const pathLocale = url.pathname.split('/')[1];

  if (!['en', 'fr', 'de'].includes(pathLocale)) {
    const preferred = negotiateLocale(req.headers.get('Accept-Language'));
    return Response.redirect(new URL(`/${preferred}${url.pathname}`, url), 302);
  }

  return next();
}
```

### Typed Locale Param

If the locale is a dynamic segment (`[locale]`) rather than a route group, it is available via `params.locale` with full type safety from the route map.

### Domain-Based Routing

Domain-based locale routing (e.g., `en.example.com`, `fr.example.com`) is not supported. Use path prefixes.

### What the Framework Does Not Do

- No message extraction or compilation
- No ICU MessageFormat runtime
- No automatic locale detection middleware — `proxy.ts` is the explicit hook
- No `next-intl`-style integration — community libraries can build on `proxy.ts` and route groups

---

## Client Navigation — Resolved Design

### RSC Payload Format for Partial Navigations

The same RSC payload format is used for all navigations — full and partial. When layouts are skipped, their segments are simply absent from the payload. The client reconstructs the tree from what it receives. No separate envelope, no skip markers. The wire protocol is identical regardless of how many segments were skipped — only the content differs.

### Back/Forward Navigation

Back/forward navigation uses **cached RSC payloads**. When the user navigates forward to a URL, the RSC payload is stored in a history stack keyed by `(url, scrollY)`. On popstate, the stored payload is replayed — no server roundtrip. This matches the expected browser feel: back is instant.

Cached history payloads are not subject to the 30-second prefetch cache lifetime — they persist for the duration of the session (or until the page is hard-reloaded). The data they contain may be stale, consistent with browser behavior for the back button.

### Scroll Restoration

- **Forward navigation** — scroll to top on every navigation to a new page.
- **Back/forward** — browser-native scroll restoration. The `scrollRestoration` property is set to `'manual'`; the framework saves `scrollY` when pushing history entries and restores it when replaying cached payloads on popstate.
- **Mounted layouts** — scroll position within a mounted layout's DOM is preserved naturally because the DOM node is never unmounted. No explicit handling needed.

### Prefetch Cache

Prefetched RSC payloads are cached on the client for **30 seconds**. A hover-then-click within that window renders instantly. After 30 seconds the payload is discarded; a click after expiry triggers a fresh server fetch.

The prefetch cache is separate from the history stack. Prefetched payloads that are consumed by a navigation move into the history stack (if the navigation was a pushState). Unconsumed prefetch entries expire and are dropped.
