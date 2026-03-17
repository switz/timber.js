# The Rendering Pipeline

## The Flush Point

The status code commits when the following are all true:

1. The route's `middleware.ts` (if any) has completed without short-circuiting
2. All `access.ts` checks have completed without denial
3. React's `onShellReady` has fired — meaning everything outside `<Suspense>` boundaries has rendered

Until all are true, no response body bytes are sent. Once they are, the correct status code is committed, the rendered shell flushes, and any `<Suspense>` boundaries stream their content into the open connection.

This is not a full buffer. The response is a stream. The difference from Next.js is when the status commits — before the first byte in timber.js, after `onShellReady` in Next.js's default streaming mode, or never accurately in streaming-first frameworks.

### Early Hints (103) — Before the Flush Point

Early Hints are the exception to "no bytes before the flush." A 103 informational response is not the real response — it's a preliminary signal sent while the server is still working. The browser receives `Link` headers and begins fetching critical resources (CSS, fonts, JS) before the first byte of HTML arrives.

```
Request arrives
  → Route matched (segment chain identified)
  → 103 Early Hints sent:
      Link: </styles/root.css>; rel=preload; as=style
      Link: </styles/dashboard.css>; rel=preload; as=style
      Link: </fonts/inter.woff2>; rel=preload; as=font; crossorigin
      Link: </_timber/client.js>; rel=modulepreload
      Link: </_timber/assets/hero.webp>; rel=preload; as=image; fetchpriority=low
  → middleware.ts runs (blocking — redirects, headers, request header injection, cache warming)
  → Build element tree → renderToReadableStream
  → onShellReady → commit real status (200/404/302) → flush shell
```

Early Hints fire at route match time — before `middleware.ts`, before `access.ts`, before any React work. At that point the framework already knows the full segment chain from the build manifest, which means it knows every CSS file, font, and client JS chunk the shell will need. No component-tree walking required.

**What gets hinted:**

- **Segment CSS** — each segment in the matched route chain has known CSS from the build manifest. Hint all of them. This gets CSS loading ~50-200ms earlier than waiting for the `<head>` to arrive in the HTML.
- **Client JS chunks** — the client runtime and route-specific chunks are known at route match time.
- **Fonts** — if font files are deterministic from the build (common with `next/font`-style tooling), hint those too.
- **Static images** (lower priority) — above-the-fold images that are statically imported (e.g., a hero image or logo via `import heroImg from './hero.webp'`) are known at build time and can be hinted with `rel=preload; as=image`. These are hinted at lower `fetchpriority` than CSS/fonts since they don't block rendering. Dynamic images (fetched from a CMS, dependent on request data) can't be hinted — they aren't known until render time.

**What doesn't get hinted:**

- Component-level CSS discovered during render. Next.js walks the component tree to collate CSS from every component import — this couples the framework to CSS tooling and adds complexity. timber.js hints at the segment level from the build manifest. Components that import CSS within Suspense boundaries are fine — those styles arrive with the streamed content anyway.
- Anything conditional on auth, cookies, or request data. Hints fire before the request is processed. They're based purely on the matched route.

**Why this is enough:** The segment chain covers the shell — root layout CSS, auth layout CSS, page CSS. That's what the browser needs to paint the initial frame. Suspense-deferred content streams later and brings its own styles. Hinting segment CSS gets the browser ~90% of the critical resources without any of the complexity of full component-tree CSS analysis.

**Platform support:** Early Hints require HTTP/2+ and platform support. Not all hosting environments pass 103 responses through to the client. The framework sends them opportunistically — if the platform doesn't support it, nothing breaks. The HTML `<head>` still contains all the same `<link>` tags as a fallback.

**103 delivery mechanism by platform:**

- **Cloudflare Workers/Pages** — the CDN automatically converts `Link` response headers into 103 Early Hints. No application-level 103 sending needed.
- **Node.js (node-server preset)** — the generated Nitro entry wraps the request handler with `runWithEarlyHintsSender()`, which installs a per-request ALS-scoped function that calls `res.writeEarlyHints()` on the raw `http.ServerResponse` (Node.js v18.11+). The pipeline calls `sendEarlyHints103()` at route-match time, which invokes the sender if installed.
- **Bun (bun preset)** — same mechanism as Node.js, using Bun's `writeEarlyHints()` implementation.
- **Serverless (Vercel, Netlify, AWS Lambda, etc.)** — no application-level 103 support. The `Link` headers are set on the response and may be picked up by the CDN layer if configured.

### Developer Control Over the Flush Point

Developers control where the flush point sits by where they place `<Suspense>` boundaries.

```tsx
// product/page.tsx
export default async function ProductPage({ params }) {
  const product = await getProduct(params.id); // outside Suspense — can 404
  if (!product) deny(404); // real HTTP 404

  return (
    <div>
      <ProductHeader product={product} />
      <Suspense fallback={<ReviewsSkeleton />}>
        <ProductReviews productId={product.id} /> {/* streams after flush */}
      </Suspense>
    </div>
  );
}
```

`getProduct` runs before the flush. If the product doesn't exist, the framework sends a real 404 with a 404 page. `<ProductReviews>` is inside a Suspense boundary — it streams after the 200 is committed. The developer chose where the line is.

The mental model: **anything outside Suspense participates in the status code decision. Anything inside Suspense does not.** This is explicit, developer-controlled, and consistent. This is the same as next.js, but we take away the footgun that is loading.js.

### The Twitter/Product Distinction

This framing helps clarify when to use Suspense and when not to:

- `/product/1` — the product is the primary resource. If it doesn't exist, the page doesn't exist. Fetch it outside Suspense. Let it 404.
- `/feed` — the feed is content, not the page identity. A missing tweet doesn't make the feed page a 404. Wrap the feed in Suspense. Let it stream.

Primary resources that define whether the page exists belong outside Suspense. Secondary content that enriches a page that already exists belongs inside Suspense if it's loading time is inconsistent and could be heavily delayed. This is a guideline, not a rule the framework enforces — but it is the mental model that makes the system predictable.

---

## Single-Pass Rendering

The entire route renders in a single `renderToReadableStream` call. The framework builds one nested React element tree — AccessGate wrappers, layouts, slots, and the page — and hands it to React as a unified tree. One render pass, one `React.cache` scope, no flight payload stitching.

```
Request arrives
  → proxy.ts (CORS, security headers, logging — wraps entire lifecycle)
  → Route matching (segment chain identified)
  → Leaf middleware.ts runs (blocking — redirects, headers, request header injection, cache warming)
  → If middleware short-circuited → send that response, done
  → Build element tree (bottom-up):
      Page wrapped in error/notFound boundaries
      Each layout wraps children, with AccessGate above it
      Slots composed as named props with SlotAccessGate wrappers
  → Single renderToReadableStream(tree)
  → Wait for onShellReady
  → If render-phase signal (redirect/deny) thrown → correct status code
  → Else → commit status code, flush shell, stream Suspense remainders
```

Middleware runs before rendering starts. It can short-circuit the request (redirects, feature flags), set response headers, inject request headers for downstream components, or fire prefetches to warm caches before any React work begins. Only the leaf route's `middleware.ts` runs — there is no middleware chain.

**ALS scope in middleware.ts:** `AsyncLocalStorage` is active during middleware execution. `cookies()`, `headers()`, and `searchParams()` all work. This is what allows the fire-and-forget prefetch pattern — `void requireUser()` can read cookies to look up the session. The only thing NOT available in middleware.ts is `React.cache`, which requires an active `renderToReadableStream` call.

The element tree for a route like `/dashboard/workspace/projects/123`:

```tsx
<AccessGate accessFn={rootAccess}>              // root access.ts (if exists)
  <RootLayout>
    <AccessGate accessFn={authAccess}>           // (authenticated) access.ts
      <AuthLayout
        children={...}
        admin={                                  // @admin parallel slot
          <SlotAccessGate accessFn={adminAccess} denied={<AdminDenied />}>
            <AdminPage />
          </SlotAccessGate>
        }
        feed={<FeedPage />}                      // @feed slot — no access.ts
      >
        <AccessGate accessFn={workspaceAccess}>
          <WorkspaceLayout>
            <AccessGate accessFn={projectAccess}>
              <ProjectPage />
            </AccessGate>
          </WorkspaceLayout>
        </AccessGate>
      </AuthLayout>
    </AccessGate>
  </RootLayout>
</AccessGate>
```

One tree. One `renderToReadableStream`. One `React.cache` scope shared by every `access.ts`, layout, slot, and page in the route.

## `AccessGate` — Framework-Injected Auth Wrapper

`AccessGate` is an async server component that the framework injects above each layout in the element tree. It runs the segment's `access.ts` before the layout renders:

```tsx
// Framework-internal component, not user-facing
async function AccessGate({ accessFn, params, searchParams, children }) {
  await accessFn({ params, searchParams });
  // cookies() and headers() are ALS-backed — access.ts imports them directly
  return <>{children}</>;
}
```

Because `AccessGate` is inside the React render pass, `React.cache` is active. A `requireUser()` call in the root segment's `AccessGate` populates the cache; the same call in a deeper `AccessGate` or a layout is a cache hit. No separate cache layer needed — `React.cache` handles per-request deduplication across the entire tree.

If `accessFn` calls `deny()`, `redirect()`, or throws an unhandled error, it is a render-phase signal. React catches it. Because timber.js holds the flush until `onShellReady`, these throws happen before any bytes are sent — the HTTP status code is correct.

## Cache Scoping Model

A single `renderToReadableStream` call means one `React.cache` scope for the entire route. This is the foundation of the data model:

| Layer               | Scope                        | Purpose                                                                                                                                        |
| ------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `React.cache`       | Per-request, per-render-pass | Deduplication within the request. All AccessGates, layouts, pages, and slots share one scope. Use for functions without cross-request caching. |
| `timber.cache`      | Cross-request (TTL/tags)     | Persistent data caching. CacheHandler lookup provides inherent dedup — no `React.cache` wrapper needed.                                        |
| `AsyncLocalStorage` | Per-request                  | `cookies()`, `headers()` — shared across the entire request.                                                                                   |

```
getUser("abc") called in AccessGate (segment 1):
  → timber.cache cacheHandler: HIT (TTL valid) → return cached value

getUser("abc") called in AuthLayout (same request):
  → timber.cache cacheHandler: HIT → return same cached value (same key, same entry)

getUser("abc") called in next request (30s later, TTL=60):
  → timber.cache cacheHandler: HIT (TTL not expired) → return cached value

getUser("abc") called 70s later (TTL expired):
  → timber.cache cacheHandler: MISS → DB query → stored with TTL
```

For functions that don't need cross-request caching, use `React.cache` directly:

```
const getSessionUser = cache(async () => {
  const session = getSessionFromCookie(cookies())
  return session ? await db.users.find(session.userId) : null
})

// Called in AccessGate → executes, result stored in React.cache
// Called in layout → React.cache HIT, no re-execution
// Next request → React.cache MISS (new render pass), re-executes
```

**middleware.ts is the exception.** Middleware runs before `renderToReadableStream`, so `React.cache` is not active. ALS is active (see above), so `cookies()` and `headers()` work. Fire-and-forget prefetches from middleware populate `timber.cache`'s cacheHandler. When the render pass starts, components calling the same `timber.cache`-wrapped functions get cacheHandler hits.

## Render-Pass Resolution

Several framework concerns — access checks, metadata, and potentially others — need to resolve during the `renderToReadableStream` call rather than before or after it. This is a deliberate pattern, not an accident.

### Why Resolve Inside the Render Pass

There are three moments framework logic can run:

1. **Before render** (`middleware.ts` phase) — `AsyncLocalStorage` active, `React.cache` not active. Good for cache warming and short-circuiting. Cannot share per-request deduplication with components.

2. **During render** (inside `renderToReadableStream`) — both `AsyncLocalStorage` and `React.cache` active. The full single-pass scope is available. Any async work here participates in the shell and resolves before `onShellReady` (as long as it's outside `<Suspense>`).

3. **After render** — too late. The status code is committed, the shell is flushing.

For concerns that need to share data with components (access checks reading `requireUser()`, metadata calling `getProduct()`), resolving during the render pass means they naturally participate in `React.cache` deduplication without any extra wiring. The same function call in an access check, in `metadata()`, and in the page component hits the cache — one execution, three consumers.

### The Pattern

The framework resolves these concerns as part of the element tree construction inside `renderToReadableStream`. The specific mechanism is an implementation detail — what matters is the contract:

- **Runs inside `renderToReadableStream`.** `React.cache` scope is shared with the entire route.
- **Outside `<Suspense>`.** Resolves as part of the shell. Completes before `onShellReady`.
- **Can throw render-phase signals.** `deny()` and `redirect()` work and produce correct HTTP status codes because the flush hasn't happened yet.
- **Benefits from middleware.ts cache warming.** `timber.cache`-wrapped functions called in middleware.ts prefetches are warm by the time render-pass resolution runs.

### What Uses This Pattern

| Concern                        | Why render-pass                                                                                                             | Behavior on failure                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `access.ts`                    | Shares `React.cache` with layouts/page. Must gate child rendering — parent access failure prevents children from executing. | Calls `deny()` or `redirect()`. Correct HTTP status.                                    |
| `metadata()`                   | Shares `React.cache` with page. Must complete before flush so `<head>` is in the shell.                                     | If it throws, treated as a render-phase error. Error boundary (`error.tsx`) catches it. |
| Slot access (`SlotAccessGate`) | Same scope as parent. Failure is graceful — renders `denied.tsx`, does not affect HTTP status.                              | Calls `deny()`. Slot degrades, page still renders.                                      |

Future framework concerns that need the single `React.cache` scope should follow this same pattern: resolve inside the render pass, outside `<Suspense>`, with `middleware.ts` cache warming as the prefetch mechanism.

## Eliminating the Data Waterfall

React renders a single tree top-down: a parent async server component must resolve before React evaluates `{children}`. With nested async layouts, this creates a data-fetching waterfall:

```
Without prefetching:
  RootLayout:   getConfig()      30ms
  AuthLayout:   requireUser()    50ms  (starts at t=30ms)
  Dashboard:    getOrg()         40ms  (starts at t=80ms)
  Page:         getProject()     45ms  (starts at t=120ms)
  TOTAL:        165ms waterfall → shell ready at t=165ms
```

The solution is middleware.ts cache warming. Middleware fires all data fetches at t=0 before the render pass begins:

```
middleware.ts fires all at t=0:
  void getConfig()               30ms  ┐
  void requireUser()             50ms  ├── max = 50ms
  void getOrg()                  40ms  │  (all resolve by t=50ms)
  void getProject(id)            45ms  ┘
  middleware returns immediately.

Render starts at t≈0:
  AccessGate:   requireUser()     → timber.cache HIT at t≈50ms
  RootLayout:   getConfig()       → timber.cache HIT at t≈50ms
  AuthLayout:   (no additional fetch)
  Dashboard:    getOrg()          → timber.cache HIT at t≈50ms
  Page:         getProject(id)    → timber.cache HIT at t≈50ms
  Shell ready at t≈50ms
```

Total time: `max(prefetch_times)` instead of `sum(layout_times)`. The developer opts into this parallelism by prefetching in middleware.ts. Without prefetching, you get the natural top-down waterfall. This fits timber.js's philosophy — no hidden magic, the developer controls the behavior.

The access.ts layer serves as a natural secondary warming point: even without middleware.ts, an `AccessGate` that calls `requireUser()` (via `timber.cache` or `React.cache`) warms the cache for all deeper segments' `AccessGate` calls and layouts that need the same data. The waterfall still exists for unrelated fetches across segments, but shared data (auth, org) is deduplicated.

---

## Parallel Slots

Parallel slots (`@slot` directories) are named content regions within a layout. They are NOT segments — they don't add URL depth. A layout receives its slots as named props alongside `{children}`:

```tsx
// app/(authenticated)/layout.tsx
export default async function AuthLayout({
  children,
  admin,
  feed,
}: {
  children: React.ReactNode;
  admin: React.ReactNode;
  feed: React.ReactNode;
}) {
  const user = await requireUser(); // timber.cache HIT — access.ts already resolved this
  return (
    <Shell user={user}>
      <aside>{admin}</aside>
      <main>{children}</main>
      <aside>{feed}</aside>
    </Shell>
  );
}
```

**Slots render within the single `renderToReadableStream` call.** The parent layout receives slot elements as named props. Each slot with an `access.ts` is wrapped in a `SlotAccessGate` component (see Access Failure section). Slots are part of the unified element tree — no separate render passes.

If a slot page is slow (async server component with I/O), it blocks the parent segment's `onShellReady`. The fix is the same as for any slow component: wrap it in `<Suspense>`. The framework does not do this automatically.

**Dev-mode slow slot warning.** In development, if a slot takes longer than `slowPhaseMs` (default: 200ms, configured via `timber.config.ts`) without a `<Suspense>` wrapper, the framework emits a console warning:

```
[timber] warn: slot @admin resolved in 847ms and is not wrapped in <Suspense>. Consider wrapping to avoid blocking the flush.
```

This warning appears only in dev mode and only when the slot is not wrapped in `<Suspense>`. It is a signal that the slot is blocking `onShellReady` — and therefore the status code commit — unnecessarily. The fix is always to wrap the slow slot in `<Suspense>`.

### Slot-Level `access.ts`

Slots can have their own `access.ts`. Each slot with an `access.ts` is wrapped in a `SlotAccessGate` component in the element tree:

```
app/
  (authenticated)/
    access.ts                    ← segment access (AccessGate)
    layout.tsx
    @admin/
      access.ts                  ← slot access (SlotAccessGate)
      page.tsx
      denied.tsx                 ← renders when slot access fails
      default.tsx                ← renders when route doesn't match slot
    @feed/
      page.tsx                   ← no access.ts, always renders if parent passes
```

```
Element tree for /dashboard:

<AccessGate accessFn={rootAccess}>
  <RootLayout>
    <AccessGate accessFn={authAccess}>
      <AuthLayout
        admin={
          <SlotAccessGate accessFn={adminAccess} denied={<AdminDenied />}>
            <AdminPage />
          </SlotAccessGate>
        }
        feed={<FeedPage />}
      >
        <DashboardPage />
      </AuthLayout>
    </AccessGate>
  </RootLayout>
</AccessGate>
```

React processes sibling slot elements naturally — `SlotAccessGate` runs when React evaluates the slot prop within the parent layout's render.

### Slot Access Failure = Graceful Degradation

Slot access failure is fundamentally different from segment access failure. Segments are the primary content — if a segment fails, the page fails. Slots are secondary content regions — if a slot fails, the slot degrades but the page still works.

When a slot's `access.ts` calls `deny()`:

- The slot renders `denied.tsx` if it exists
- Falls back to `default.tsx` if no `denied.tsx`
- Falls back to `null` (slot renders nothing) if neither exists
- Parent layout still renders. Sibling slots still render. **HTTP status is unaffected**

```tsx
// @admin/access.ts
import type { AccessContext } from '@timber/app/server';
import { deny } from '@timber/app/server';

export default async function access(ctx: AccessContext) {
  const user = await requireUser(); // cache hit from parent's access
  if (user.role !== 'admin') deny(); // → renders denied.tsx
  // warming cache for slot page below
  await getAdminPermissions(user.id);
}
```

`deny()` is the same function in both segment and slot contexts — the framework handles the behavioral difference. In a segment, `deny()` produces an HTTP status code. In a slot, `deny()` triggers graceful degradation. `redirect()` is not available in slot access (dev-mode error) — redirecting from a slot doesn't make sense.

### `denied.tsx` — Slot Access Denied Fallback

`denied.tsx` is a new file convention for the UI shown when a slot's `access.ts` denies access. It is distinct from:

- `error.tsx` / `5xx.tsx` — render-phase exceptions (errors thrown during component rendering)
- `default.tsx` — route mismatch (the current URL doesn't match this slot's page)

```tsx
// @admin/denied.tsx
export default function AdminDenied() {
  return <div className="text-muted">Admin access required</div>;
}
```

### Slot Access Rules

- **Parent must pass first.** If the parent segment's `access.ts` fails, the entire segment (including all slots) is denied. Normal "shallowest failure wins" applies.
- **No access check for `default.tsx`.** When the route doesn't match the slot (slot shows its `default.tsx` fallback), the slot's `access.ts` does not run.
- **Slot access throws (not `deny()`).** Slot renders `error.tsx` (render-phase error boundary). Dev-mode warning — slot access should use `deny()`, not throw unhandled errors.
- **Client navigation.** Full access chain re-runs (segments + slots). A slot that was accessible may gracefully degrade on the next navigation if permissions change.

---

## Access Failure

When a segment's `access.ts` denies the request (via `deny()`, `redirect()`, or `throw`), the `AccessGate` component throws a render-phase signal. React processes the tree top-down, so the **shallowest failure is encountered first** — React never reaches deeper segments because the failing `AccessGate` prevents its children from rendering.

- The failing `AccessGate` throws before its layout or any child segments render
- React catches the signal. Ancestor layouts that already rendered produce valid output
- HTTP status is correct (302, 401, 403, 404, 500) because nothing has flushed yet — timber.js holds the flush until `onShellReady`

```
Route: /dashboard/workspace/projects/123
Segment 1 AccessGate fails (user not authenticated):

  React renders top-down:
    AccessGate(root) → passes
      RootLayout → rendered
        AccessGate(auth) → calls redirect('/login')
          ← React stops here. AuthLayout, Dashboard, Page never execute.

Result:
  RootLayout (rendered successfully)
    → redirect('/login'), HTTP 302

Segment 3 AccessGate fails (user not workspace member):

  React renders top-down:
    AccessGate(root) → passes
      RootLayout → rendered
        AccessGate(auth) → passes
          AuthLayout → rendered
            AccessGate(workspace) → calls deny()
              ← React stops here. WorkspaceLayout, Page never execute.

Result:
  RootLayout (rendered)
    AuthLayout (rendered — user is authenticated)
      → deny() at workspace segment position
      HTTP 403
```

---

## RSC → SSR → Client Hydration

The RSC Flight stream is produced by a single `renderToReactStream` call and consumed by three downstream paths:

```
RSC renderToReactStream(tree)
  │
  ├── .tee() ──┬── SSR stream → createFromReadableStream → renderToReadableStream → HTML
  │             │
  │             └── Inline stream → injectRscPayload → progressive <script> tags in HTML body
  │
  └── (RSC payload request from client navigation) → returned directly, no SSR
```

### Stream Tee

For HTML responses, the RSC stream is tee'd into two copies:

1. **SSR stream** — decoded via `createFromReadableStream` from `@vitejs/plugin-rsc/ssr`, resolving `"use client"` references to actual component modules. The decoded element tree is rendered to HTML via `renderToReadableStream`.

2. **Inline stream** — passed to `injectRscPayload()`, which uses a two-stage pipeline: (a) `createInlinedRscStream` transforms RSC binary chunks into `<script>` tags using pull-based reads and JSON-encoded typed tuples (`[0]` bootstrap, `[1, data]` Flight data), and (b) `createFlightInjectionTransform` strips `</body></html>` from the shell so all subsequent content is at `<body>` level, buffers RSC script tags and drains them only after the suffix is stripped — guaranteeing scripts are always direct children of `<body>` regardless of how chunks are split — then re-emits the suffix at the very end. The browser entry patches `self.__timber_f.push` to feed chunks into `createFromReadableStream` progressively, and uses `DOMContentLoaded` to close the stream — hydration can start before all Suspense boundaries resolve.

### RSC Payload Requests

For client-side navigation requests (`Accept: text/x-component`), the RSC stream is returned directly — no tee, no SSR, no HTML. The client decodes it via `createFromFetch` and renders it into the hydrated React root.

### Bootstrap Scripts and Streaming Hydration

The bootstrap script is injected via React's `bootstrapScriptContent` option on `renderToReadableStream`. This is critical for streaming:

- **`<script type="module">` is deferred by the HTML spec** — it doesn't execute until the document finishes parsing. During streaming SSR, the HTML parser doesn't finish until all Suspense boundaries resolve and `</body>` arrives. This means module scripts block hydration behind Suspense.

- **Dynamic `import()` in a regular inline script executes immediately** during HTML parsing, even while Suspense boundaries are still streaming. React injects the bootstrap as a non-deferred `<script>` in the shell HTML.

In dev mode, the bootstrap imports both the Vite HMR client and the browser entry virtual module. In production, it imports the hashed chunk URL from the build manifest, with `<link rel="modulepreload">` hints injected into `<head>` for dependency preloading.

> **Browser compat note:** Dynamic `import()` has the same browser support as `<script type="module">` — all modern browsers. If we need to target older browsers that support modules but not dynamic import (unlikely in practice), we may need to evaluate emitting IIFE/CJS bundles via Vite's `build.lib` options. Track this as a production validation item.

### Hydration Bootstrap

On page load, the browser entry:

1. Reads the progressive RSC payload from `self.__timber_f` (chunks arrive as inline scripts during streaming)
2. Decodes it via `createFromReadableStream` into a React element tree
3. Calls `hydrateRoot(document, element)` — React owns the full document since root layout renders `<html>`
4. Stores the decoded element in the history stack for instant back/forward replay
5. Initializes the client-side navigation router (link interception, popstate, prefetch)

`createFromReadableStream` resolves its thenable when the first Flight row (the shell) is decoded, not when the stream closes. This means hydration can begin as soon as the shell arrives — Suspense boundaries resolve progressively as their RSC chunks stream in.

If no RSC payload is available (e.g., `noClientJavascript` mode or incomplete inlining), a non-hydrated `createRoot(document)` is used as a fallback — the first client navigation will replace the SSR HTML with a React-managed tree.
