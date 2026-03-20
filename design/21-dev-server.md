# Dev Server & HMR

This document consolidates and extends the dev server requirements scattered across [11-platform.md](11-platform.md), [17-logging.md](17-logging.md), [18-build-system.md](18-build-system.md), and [05-streaming.md](05-streaming.md) into a single comprehensive design.

---

## Overview

`timber dev` starts a Vite-based dev server. The server intercepts incoming requests via a `configureServer` pre-hook middleware, routes them through the timber pipeline (proxy → canonicalize → route match → middleware → access → render → flush), and streams the response back to the browser. All module loading uses Vite's `ssrLoadModule` against the dev module graph — no built bundles.

The dev server is **not** a separate server. It is a Vite plugin (`timber-dev-server`) that registers a Connect middleware. Vite handles static file serving, HMR websocket management, and module transforms. Timber handles request routing and rendering.

---

## Architecture

### Request Flow

```
Browser request
  → timber-dev-server middleware (pre-hook — runs before Vite internals)
    → Skip if Vite-internal (/@, /__vite, /node_modules/)
    → Skip if static asset (.js, .css, .png, etc.)
    → Convert Node IncomingMessage → Web Request
    → ssrLoadModule('virtual:timber-rsc-entry')
    → handler(webRequest) — full pipeline
    → Convert Web Response → Node ServerResponse (streaming)
    → On no-match 404 (X-Timber-No-Match): pass through to Vite's fallback
    → On route-level 404 (deny(404)): serve as real 404 response
    → On error: 500 with stack trace in dev overlay format
  → Vite built-in middleware (static files, HMR, transforms) — only if timber passed through
```

**Pre-hook vs post-hook:** The middleware registers as a pre-hook (called directly in `configureServer`, not returned as a function) so it sees the original request URL before Vite's `historyApiFallback` can rewrite it to `/index.html`. Vite-internal and asset requests are filtered explicitly and passed through.

**No-match vs deny 404:** When the route matcher finds no match, the pipeline returns `404` with an `X-Timber-No-Match` header. The dev server uses this to distinguish "no route found" (pass through to Vite) from a deliberate `deny(404)` thrown during rendering (serve as a real 404 response).

### Plugin Registration

`timber-dev-server` is a sub-plugin in the timber plugin array. It is only active when `command === 'serve'` (not during build).

```ts
export function timber(config?: TimberUserConfig): Plugin[] {
  const ctx = createPluginContext(config);
  return [
    timberRootSync(ctx), // configResolved: sync ctx.root/appDir with Vite
    timberShims(ctx),
    timberRouting(ctx), // configureServer: file watching
    timberEntries(ctx),
    timberCache(ctx),
    timberStaticBuild(ctx),
    timberDynamicTransform(ctx),
    timberFonts(ctx),
    timberMdx(ctx),
    timberContent(ctx), // configureServer: content watching
    timberDevServer(ctx), // configureServer: request handling (must be last)
  ];
}
```

`timber-root-sync` **must be the first plugin** — it uses `configResolved` to sync `ctx.root` and `ctx.appDir` with Vite's resolved root. Without this, the plugin context uses `process.cwd()` as root, which is wrong when `--config` points to a subdirectory (e.g., `vite --config examples/blog/vite.config.ts` with `root: import.meta.dirname`).

`timber-dev-server` **must be the last plugin** in the array so its `configureServer` pre-hook runs after all other plugins have registered their hooks and watchers.

---

## HMR Wiring

### Three-Environment Model

Vite's environment-aware dev server maintains three separate module graphs:

| Environment | Module Graph                                                          | HMR Channel                           | Purpose                  |
| ----------- | --------------------------------------------------------------------- | ------------------------------------- | ------------------------ |
| `rsc`       | Server Components, middleware, access, layouts, pages, route handlers | Module invalidation (no browser push) | RSC rendering            |
| `ssr`       | SSR entry, client component SSR fallbacks                             | Module invalidation (no browser push) | HTML hydration rendering |
| `client`    | Client components, browser runtime, CSS                               | WebSocket to browser                  | Browser interactivity    |

### Invalidation Rules

When a file changes, the correct environment(s) must be invalidated:

| File Changed                                                       | Invalidation                      | Effect                                |
| ------------------------------------------------------------------ | --------------------------------- | ------------------------------------- |
| Server component (`page.tsx`, `layout.tsx` without `"use client"`) | RSC module graph                  | Next request re-renders from scratch  |
| Client component (`"use client"` file)                             | Client module graph → browser HMR | React Fast Refresh preserves state    |
| `middleware.ts`                                                    | RSC module graph                  | Next request re-runs middleware chain |
| `access.ts`                                                        | RSC module graph                  | Next request re-runs access gates     |
| Route handler (`route.ts`)                                         | RSC module graph                  | Next request re-runs handler          |
| CSS/Tailwind                                                       | Client module graph → browser HMR | Hot style update, no full reload      |
| `timber.config.ts`                                                 | **Full dev server restart**       | Config is loaded once at startup      |

### Implementation: Vite's Built-in HMR

Timber does **not** implement custom HMR logic. Vite's module graph already tracks dependencies and invalidates on change. The key behaviors:

1. **RSC environment**: Vite invalidates the module when the file changes. On the next request, `ssrLoadModule` re-evaluates the module and its transitive dependencies. No explicit invalidation code needed in `timber-dev-server` — Vite handles it. When a server component is edited, `@vitejs/plugin-rsc` sends an `rsc:update` custom HMR event over WebSocket. The browser entry listens for this event and calls `router.refresh()` to re-fetch the RSC payload with updated server code — avoiding a full page reload.

2. **Client environment**: Vite sends HMR updates over WebSocket. React Fast Refresh (via `@vitejs/plugin-react`) handles component state preservation. Timber does not interfere. `@vitejs/plugin-react` is placed **before** `@vitejs/plugin-rsc` in the plugin array. The RSC plugin's `virtual:vite-rsc/entry-browser` module sets up Fast Refresh globals (`$RefreshReg$`, `$RefreshSig$`) before dynamically importing timber's browser entry. The dev bootstrap script imports this RSC entry module — not `virtual:timber-browser-entry` directly — so the preamble is established before any client component modules evaluate.

3. **Config restart**: `timber-dev-server` watches `timber.config.ts` (and `timber.config.js`, `timber.config.mjs`) via `server.watcher`. On change, it calls `server.restart()` to trigger a full Vite dev server restart.

### Route Tree Watching

Handled by `timber-routing`, not `timber-dev-server`. When `page.tsx`, `layout.tsx`, `middleware.ts`, `access.ts`, or `route.ts` is added/removed in `app/`, the virtual route manifest is regenerated and dependent modules are invalidated. See [18-build-system.md](18-build-system.md) §Route Tree Watching.

### Content Collection Watching

Handled by `timber-content`. When content files change in `content/`, the content manifest is regenerated with HMR support. See [20-content-collections.md](20-content-collections.md).

---

## Dev Logging

### Structured Request Tree

Every request emits a structured tree to `process.stderr` showing the full execution pipeline with timing:

```
POST /dashboard/projects/123  trace_id: 4bf92f3577b34da6a3ce929d0e0e4736
├─ [proxy]   proxy.ts                               0ms →  2ms
├─ [rsc]     middleware.ts                           2ms →  4ms
│  ├── fired: requireUser()                    (timber.cache prefetch)
│  ├── fired: getProject("123")               (timber.cache prefetch)
│  └── fired: getTaskCounts("123")            (timber.cache prefetch)
│             ↳ all 3 running in parallel
├─ [rsc]     render                                 4ms
│  ├─ [rsc]  AccessGate (authenticated)             4ms →  5ms
│  │  └── requireUser()                        timber.cache HIT  <1ms
│  ├─ [rsc]  AuthLayout                             5ms →  7ms
│  ├─ [rsc]  AccessGate (project)                   7ms →  8ms
│  ├─ [rsc]  ProjectPage                            8ms → 12ms
│  └── onShellReady                                12ms
├─ [ssr]     hydration render                      13ms → 18ms
└─ ✓ 200 OK                              total    18ms
   └─ [rsc]  RecentActivity (Suspense)              ·  → 94ms  (streamed)
```

### Implementation

Dev logging is **instrumentation-based**, not middleware-based. The rendering pipeline itself emits timing events via a dev-only event emitter. The dev logger subscribes to these events and builds the tree structure.

```ts
// Conceptual — not the final API
interface DevLogEvent {
  type: 'phase-start' | 'phase-end' | 'cache-hit' | 'cache-miss' | 'warning';
  environment: 'rsc' | 'ssr' | 'client' | 'proxy';
  label: string;
  timestampMs: number;
  parentId?: string;
}
```

The dev logger:

1. Collects events for the duration of a request (keyed by request ID)
2. On response end, formats the tree and writes to stderr
3. For streaming responses, emits the shell summary on flush, then appends Suspense resolution lines as they complete

### Configuration

| Control                              | Default | Effect                                            |
| ------------------------------------ | ------- | ------------------------------------------------- |
| `TIMBER_DEV_LOG=tree`                | Default | Full indented tree per request                    |
| `TIMBER_DEV_LOG=summary`             | —       | One line per request: `POST /path → 200 OK  18ms` |
| `TIMBER_DEV_QUIET=1`                 | —       | Suppress all dev console output                   |
| `timber.config.ts → dev.slowPhaseMs` | `200`   | Highlight phases slower than this threshold       |

### Slow Phase Highlighting

When any phase exceeds `slowPhaseMs`, it is highlighted in the tree output (bold/yellow in terminals that support ANSI). This surfaces performance issues without requiring explicit profiling.

---

## Dev-Mode Warnings

The framework emits warnings for common footguns. These are console warnings (not errors) that appear in both the terminal and the browser console.

### Warning Catalog

| ID                        | Trigger                                                              | Message                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SUSPENSE_WRAPS_CHILDREN` | `<Suspense>` directly wraps `{children}` in a layout                 | `Layout at app/dashboard/layout.tsx wraps {children} in <Suspense>. This prevents child pages from setting HTTP status codes. Use useNavigationPending() for loading states instead.`                                    |
| `DENY_IN_SUSPENSE`        | `deny()` called inside a `<Suspense>` boundary                       | `deny() called inside <Suspense> at app/dashboard/page.tsx:42. The HTTP status is already committed — this will trigger an error boundary with a 200 status. Move deny() outside <Suspense> for correct HTTP semantics.` |
| `REDIRECT_IN_SUSPENSE`    | `redirect()` called inside a `<Suspense>` boundary                   | `redirect() called inside <Suspense> at app/dashboard/page.tsx:55. This will perform a client-side navigation instead of an HTTP redirect.`                                                                              |
| `REDIRECT_IN_ACCESS`      | Slot access calling `redirect()`                                     | `redirect() called in access.ts at app/admin/access.ts:12. Only deny() is valid in slot access checks. Use deny() to block access or move redirect() to middleware.ts.`                                                  |
| `STATIC_REQUEST_API`      | `cookies()`/`headers()` called during static build                   | `cookies() called during static generation of /about. Dynamic request APIs are not available during prerendering.`                                                                                                       |
| `CACHE_REQUEST_PROPS`     | `"use cache"` component receives request-specific props              | `Cached component UserGreeting receives prop "userId" which appears request-specific. Cached components should not depend on per-request data.`                                                                          |
| `SLOW_SLOT_NO_SUSPENSE`   | Slot resolves slower than `slowPhaseMs` without `<Suspense>` wrapper | `Slot @admin resolved in 847ms and is not wrapped in <Suspense>. Consider wrapping to avoid blocking the flush.`                                                                                                         |

### Implementation

Warnings are detected at different layers:

- **AST-level** (`SUSPENSE_WRAPS_CHILDREN`): Detected during the RSC transform phase. The transform plugin checks if a layout component's JSX tree has a `<Suspense>` element whose children prop is `{children}` (the slot).

- **Runtime** (`DENY_IN_SUSPENSE`, `REDIRECT_IN_SUSPENSE`, `REDIRECT_IN_ACCESS`): Detected during rendering. The `deny()` and `redirect()` functions check whether they're being called inside a Suspense boundary (tracked via React context or ALS) and whether the current context is an access check.

- **Runtime** (`SLOW_SLOT_NO_SUSPENSE`): Detected by the rendering pipeline's timing instrumentation.

- **Build-time** (`STATIC_REQUEST_API`): Detected during prerendering passes when dynamic APIs are called.

- **Transform-time** (`CACHE_REQUEST_PROPS`): Heuristic detection during `"use cache"` transformation. This is best-effort — not all request-specific props can be detected statically.

### Warning Deduplication

Each warning is emitted **once per unique location** per dev server session. A `Set<string>` of `warningId:filePath:line` keys tracks which warnings have been shown. This prevents noisy repetition during HMR cycles.

---

## Error Overlay

### Integration with Vite's Error Overlay

Timber hooks into Vite's built-in error overlay (`server.ssrFixStacktrace` + `server.ws.send('error', ...)`) rather than implementing a custom overlay. This ensures consistency with the Vite ecosystem and avoids maintaining browser-side overlay code.

### Error Categories

| Phase            | Error Source                               | Overlay Content                                   |
| ---------------- | ------------------------------------------ | ------------------------------------------------- |
| Module transform | Syntax errors in RSC/SSR modules           | Vite's default: file, line, code frame            |
| Route matching   | No matching route (404)                    | Not an error — passed through to Vite's fallback  |
| Middleware       | Exception in `middleware.ts`               | Stack trace with middleware file highlighted      |
| Access check     | Exception in `access.ts` (not `deny()`)    | Stack trace with access file highlighted          |
| RSC render       | React render error in server component     | **Component stack** + file stack trace            |
| SSR render       | React hydration/render error               | Component stack + file stack trace                |
| Handler          | Exception in `route.ts` handler            | Stack trace with handler file highlighted         |
| Client           | Uncaught runtime error in client component | Stack trace + component stack (forwarded via HMR) |

### Component Stacks

For React render errors, the overlay includes React's component stack (the hierarchy of React components leading to the error). This is extracted from the error's `componentStack` property, which React attaches to errors thrown during rendering.

```
Error: Cannot read property 'name' of undefined

Component Stack:
  at ProductCard (app/products/product-card.tsx:23)
  at ProductGrid (app/products/product-grid.tsx:15)
  at ProductPage (app/products/page.tsx:8)
  at AccessGate
  at RootLayout (app/layout.tsx:12)

    at ProductCard (app/products/product-card.tsx:23:18)
    at renderComponent (packages/timber-app/src/server/render.ts:45:3)
    ...
```

### Terminal Error Output

In addition to the browser overlay, errors are logged to stderr with the same structured format. The terminal output includes ANSI colors for readability:

- Red for the error message
- Dim for framework-internal frames
- Normal for application frames

### Client Error Forwarding

Uncaught client-side errors (from `window.error` and `unhandledrejection` events) are forwarded to the dev server via Vite's HMR channel (`import.meta.hot.send('timber:client-error', ...)`). The dev server receives these events, parses the first app frame for source location, and echoes them back as `{ type: 'error' }` payloads to trigger Vite's overlay. This gives client component errors the same overlay treatment as server-side errors.

The browser entry also listens for `timber:dev-warning` custom events sent by the server (from `dev-warnings.ts`) and logs them to the browser console with appropriate log levels (`console.warn` or `console.error`).

### Recovery

After an error, the dev server remains running. When the developer fixes the file, Vite's HMR invalidates the module. The next browser request (or automatic refresh triggered by the overlay) re-runs the pipeline with the fixed code.

---

## Node ↔ Web Request Conversion

The dev server converts between Node's `IncomingMessage`/`ServerResponse` and the Web `Request`/`Response` APIs. The timber pipeline operates on Web APIs; the Vite dev server operates on Node APIs.

### Request Conversion (`IncomingMessage` → `Request`)

- Protocol: always `http` in dev (Vite's dev server doesn't do TLS)
- Host: from `Host` header, fallback `localhost`
- Headers: all headers forwarded, multi-value headers use `append()`
- Body: for methods with bodies (POST, PUT, PATCH, DELETE), the Node readable stream is converted to a Web `ReadableStream` with `duplex: 'half'`

### Response Conversion (`Response` → `ServerResponse`)

- Status code copied
- All headers copied via `setHeader()`
- Body streamed chunk-by-chunk via `getReader()` + `write()` — no buffering
- On stream completion, `end()` is called

### Future: Direct Web API Support

When Vite adds native Web API middleware support (tracked upstream), the Node↔Web conversion layer can be removed. The timber pipeline already operates on Web APIs, so this is a drop-in simplification.

---

## Configuration

Dev server behavior is configured via `timber.config.ts`:

```ts
// timber.config.ts
export default {
  dev: {
    // Highlight phases slower than this in dev logging
    slowPhaseMs: 200, // default: 200

    // Port for the dev server (passed to Vite)
    port: 3000, // default: Vite's default (5173)

    // Open browser on start
    open: false, // default: false
  },
};
```

Environment variables override config file values:

- `TIMBER_DEV_QUIET=1` — suppress all dev console output
- `TIMBER_DEV_LOG=tree|summary` — log verbosity

---

## Decisions

| #   | Decision                                        | Rationale                                                                                                                                                                                |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `timber-dev-server` is last in the plugin array | Its `configureServer` pre-hook must run after all other plugins have set up their watchers and virtual modules                                                                           |
| 2   | No custom HMR protocol                          | Vite's built-in module invalidation handles RSC/SSR. Client HMR is React Fast Refresh via `@vitejs/plugin-react`. No custom WebSocket messages needed.                                   |
| 3   | Config change triggers full restart             | `timber.config.ts` is loaded once and shared via the plugin context. Partial reloading would require all plugins to support dynamic reconfiguration — not worth the complexity.          |
| 4   | Dev logging via event emitter, not middleware   | Middleware can only see the start and end of a request. Event-based instrumentation captures the internal pipeline structure (middleware, access checks, render phases, cache hits).     |
| 5   | Warnings deduplicated per session               | Prevents noise during HMR — a warning for a file triggers once, not on every save.                                                                                                       |
| 6   | Use Vite's error overlay                        | Avoids maintaining custom browser-side overlay code. Consistent with developer expectations from the Vite ecosystem.                                                                     |
| 7   | No-match 404 passes through to Vite             | Only "no route matched" 404s (marked with `X-Timber-No-Match` header) pass through to Vite's fallback. Route-level 404s from `deny(404)` are served directly as real HTTP 404 responses. |
| 8   | `timber-root-sync` is first in the plugin array | Uses `configResolved` to sync `ctx.root`/`ctx.appDir` with Vite's resolved root, which may differ from `process.cwd()` when using `--config` or Vite's `root` option.                    |
| 9   | Pre-hook middleware, not post-hook              | Registers middleware before Vite's built-in `historyApiFallback`, which would otherwise rewrite route URLs (e.g., `/blog`) to `/index.html` before our handler sees them.                |
| 10  | Server-Timing header in dev mode only           | Emits `Server-Timing` header so Chrome DevTools shows per-phase timing breakdowns in the Network panel. Uses ALS-based collector (not OTEL spans directly) to capture pre-flush timings. Dev-only to prevent information disclosure in production. |
