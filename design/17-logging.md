# Logging & Observability

Three distinct systems: **`instrumentation.ts`** for one-time server startup setup (SDK initialization, logger wiring), **production logging** for operational events, and **dev logging** for execution visibility during development.

---

## `instrumentation.ts` — The Entry Point

`instrumentation.ts` is a file convention at the project root. It exports two optional functions:

- **`register()`** — called once when the server process starts, before the first request is handled. This is where the OTEL SDK, logger, and any other observability tooling is initialized. Async-safe: the server waits for `register()` to complete before accepting requests.
- **`onRequestError()`** — called for every unhandled server error, regardless of phase. The unified error hook for error reporting services.

```
my-app/
  app/
  instrumentation.ts    ← server startup & error hooks
  timber.config.ts      ← framework config (adapters, output mode, etc.)
```

`instrumentation.ts` lives at the project root, not inside `app/`. It is a server-only file — never bundled for the browser.

---

## `register()` — Server Startup

`register()` runs once when the server starts. It is the correct place to initialize any SDK that needs to be set up before request handling begins: OTEL, loggers, error reporters, feature flag SDKs.

```typescript
// instrumentation.ts — @vercel/otel (simplest, works on Cloudflare too)
import { registerOTel } from '@vercel/otel'
import pino from 'pino'

export const logger = pino({ level: 'info' })

export function register() {
  registerOTel({ serviceName: 'my-app' })
}
```

**Dynamic imports inside `register()`** — recommended for platform-specific SDKs. Avoids unintended side effects at module evaluation time and keeps conditional imports explicit:

```typescript
// instrumentation.ts — Node.js SDK (full control, Node only)
export async function register() {
  if (process.env.TIMBER_RUNTIME === 'node') {
    await import('./instrumentation.node')
  }
}
```

```typescript
// instrumentation.node.ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'my-app' }),
  traceExporter: new OTLPTraceExporter(),
})
sdk.start()
```

`register()` can also be used for non-observability startup work: warming a connection pool, seeding a cache, validating environment variables before any request is served.

---

## `onRequestError()` — The Error Hook

`onRequestError()` is called for every unhandled error on the server, regardless of which phase it occurred in. The unified hook for error reporting services.

```typescript
// instrumentation.ts — Sentry
import * as Sentry from '@sentry/node'
import type { Instrumentation } from '@timber/app'

export async function onRequestError(
  error: unknown,
  request: Instrumentation.RequestInfo,
  context: Instrumentation.ErrorContext
) {
  Sentry.captureException(error, {
    extra: { path: request.path, phase: context.phase, route: context.routePath },
  })
}
```

### Parameters

```typescript
namespace Instrumentation {
  export type OnRequestError = (
    error: unknown,
    request: RequestInfo,
    context: ErrorContext
  ) => void | Promise<void>

  export interface RequestInfo {
    method: string               // 'GET', 'POST', etc.
    path: string                 // '/dashboard/projects/123'
    headers: Record<string, string>
  }

  export interface ErrorContext {
    phase: 'proxy' | 'handler' | 'render' | 'action' | 'route'
    routePath: string            // '/dashboard/projects/[id]'
    routeType: 'page' | 'route' | 'action'
    traceId: string              // always set — OTEL trace ID or UUID fallback
  }
}
```

`onRequestError` does not affect the response. If it throws, the error is caught and logged server-side.

---

## Production Logging — Bring Your Own Logger

timber.js does not ship a logger. Export any object with `.info()` / `.warn()` / `.error()` / `.debug()` methods from `instrumentation.ts` — the framework picks it up automatically. pino, winston, consola, and `console` all satisfy this without adapters. Silent if no `logger` export is present.

```typescript
// instrumentation.ts
import pino from 'pino'

export const logger = pino({ level: 'info' })
```

### The Logger Interface

```typescript
interface TimberLogger {
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
  debug(msg: string, data?: Record<string, unknown>): void
}
```

### What the Framework Logs

The framework emits a small, fixed set of events. In production, only events that matter for operations:

| Level | Event | Data |
|---|---|---|
| `info` | Request completed | `method`, `path`, `status`, `durationMs`, `trace_id` |
| `warn` | Adapter does not support `waitUntil()` _(startup, once)_ | — |
| `warn` | Slow request exceeded threshold | `method`, `path`, `durationMs`, `threshold`, `trace_id` |
| `warn` | `staleWhileRevalidate` refetch failed | `cacheKey`, `error`, `trace_id` |
| `warn` | `waitUntil()` promise rejected | `error`, `trace_id` |
| `error` | Unhandled error in middleware phase | `method`, `path`, `error`, `trace_id` |
| `error` | Unhandled render-phase error | `method`, `path`, `error`, `trace_id` |
| `error` | `proxy.ts` threw uncaught error | `error`, `trace_id` |
| `debug` | Request received | `method`, `path`, `trace_id` |
| `debug` | Middleware short-circuited | `method`, `path`, `status`, `trace_id` |
| `debug` | `timber.cache` MISS | `cacheKey`, `trace_id` |

The `waitUntil()` startup warning is emitted once during `register()` — before the first request — so it appears at the top of the log output and is not repeated per-call.

`trace_id` is always present — never `undefined`. See [OpenTelemetry — `trace_id` is Always Set](#trace_id-is-always-set).

### `slowRequestMs`

```typescript
// timber.config.ts
export default {
  slowRequestMs: 3000,  // default: 3000ms. Set 0 to disable.
}
```

---

## OpenTelemetry

### How It Works

timber.js depends on `@opentelemetry/api` — the vendor-neutral OTEL API package — to emit spans. The API is a no-op by default. When the developer initializes an OTEL SDK in `register()`, the API routes spans to that SDK's exporter. No SDK = no spans, zero overhead.

This is the standard OTEL separation: `@opentelemetry/api` is a stable interface that libraries depend on; the SDK (`@opentelemetry/sdk-node`, `@vercel/otel`, etc.) is what the developer installs and configures. timber.js is a library in this model — it never depends on a specific SDK.

### `trace_id` is Always Set

`trace_id` is the per-request correlation handle. It is always present — whether or not an OTEL SDK is configured.

- **With OTEL**: `trace_id` is the OTEL trace ID (32-char lowercase hex, e.g. `4bf92f3577b34da6a3ce929d0e0e4736`). It matches exactly what appears in Jaeger, Honeycomb, Datadog, etc. — click from a log entry directly to the trace.
- **Without OTEL**: `trace_id` is generated in the same format — 32-char lowercase hex, no hyphens — using `crypto.randomUUID().replace(/-/g, '')`. Same entropy, same uniqueness, identical format.

The format is always `[0-9a-f]{32}`, with or without OTEL. Log parsers, dashboards, and alerting rules keyed on `trace_id` work identically before and after adding an OTEL SDK. Adding OTEL later is a zero-friction upgrade — the field gets richer (correlated to a real distributed trace) but never changes shape.

`trace_id` is accessible anywhere in server code:

```typescript
import { traceId } from '@timber/app/server'

// In middleware.ts, access.ts, server components, server actions:
logger.info('fetching product', { traceId: traceId(), productId: params.id })
```

`traceId()` reads from timber.js's ALS store. When OTEL is active, the stored value is the OTEL trace ID. When not, it is the generated hex ID from request start. Same call, same field name, same format, regardless of OTEL configuration.

### Setup

```typescript
// instrumentation.ts — @vercel/otel (simplest, works on Cloudflare)
import { registerOTel } from '@vercel/otel'

export function register() {
  registerOTel({ serviceName: 'my-app' })
}
```

```typescript
// instrumentation.ts — Node.js SDK (full control, Node only)
export async function register() {
  if (process.env.TIMBER_RUNTIME === 'node') {
    await import('./instrumentation.node')
  }
}
```

### Framework-Emitted Spans

Once an SDK is initialized, timber.js emits spans for every phase of the request lifecycle.

#### Root span: `http.server.request`

One per incoming request. Follows [OTel HTTP server semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/).

| Attribute | Value |
|---|---|
| `http.request.method` | `'GET'`, `'POST'`, etc. |
| `http.response.status_code` | Final HTTP status code |
| `url.path` | `/dashboard/projects/123` |
| `http.route` | `/dashboard/projects/[id]` (pattern, not value) |

#### Child spans

| Span name | When emitted | Key attributes |
|---|---|---|
| `timber.proxy` | `proxy.ts` execution | `timber.result`: `'next'` \| `'short-circuit'` |
| `timber.middleware` | `middleware.ts` execution | `timber.route`, `timber.result`: `'continue'` \| `'short-circuit'` \| `'error'` |
| `timber.access` | Each `access.ts` execution | `timber.segment`, `timber.result`: `'pass'` \| `'deny'` \| `'redirect'` |
| `timber.render` | Full RSC render pass | `timber.route`, `timber.environment`: `'rsc'` |
| `timber.render.suspense` | Each `<Suspense>` boundary that streams | `timber.boundary`, `timber.flush`: `'pre'` \| `'post'` |
| `timber.ssr` | SSR hydration render | `timber.environment`: `'ssr'` |
| `timber.action` | Server action execution | `timber.action_file`, `timber.action_name` |
| `timber.metadata` | `generateMetadata()` execution | `timber.segment` |

`timber.cache` calls are recorded as **span events** on the enclosing span — not child spans. Keeps cardinality low:

```
timber.render span
  event: timber.cache.hit   { key: 'getProject("123")', source: 'handler-prefetch' }
  event: timber.cache.hit   { key: 'requireUser()', source: 'previous-request' }
  event: timber.cache.miss  { key: 'getOrg("acme")', duration_ms: 34 }
```

### Trace Context Propagation

- **Incoming requests**: If the request carries a `traceparent` header, the root `http.server.request` span is created as a child of the incoming trace. Distributed traces from upstream services stitch together correctly.
- **RSC → SSR boundary**: The active OTEL context is carried through timber.js's ALS store across the RSC and SSR Vite environments. Both environments' spans appear under the same root trace — one trace per request.
- **Outgoing fetch**: Register `@opentelemetry/instrumentation-fetch` or `@opentelemetry/instrumentation-undici` in `register()` and outbound fetch calls automatically carry `traceparent` and appear as child spans.

### Log–Trace Correlation

When a log entry is emitted while an active OTEL span is present, timber.js automatically injects `trace_id` and `span_id` into the log entry's data payload. No developer wiring required:

```json
{
  "level": "info",
  "msg": "request completed",
  "method": "GET",
  "path": "/dashboard/projects/123",
  "status": 200,
  "durationMs": 18,
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7"
}
```

This is the same `trace_id` that appears in Jaeger, Honeycomb, Datadog, etc. — click from a log line directly to the trace with no manual field mapping.

### Custom Spans

Use `@opentelemetry/api` directly — no timber-specific wrapper:

```typescript
// app/products/[id]/page.tsx
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('my-app')

export default async function ProductPage({ params }) {
  const product = await tracer.startActiveSpan('db.getProduct', async (span) => {
    try {
      return await db.products.findById(params.id)
    } finally {
      span.end()
    }
  })
  if (!product) deny(404)
  return <ProductView product={product} />
}
```

Because timber.js carries the OTEL context through its ALS store, custom spans anywhere in the render pass — components, handlers, access checks — are correctly nested under the active `timber.render` span.

### Cloudflare Workers

Use `@vercel/otel` — designed for the Workers runtime:

```typescript
// instrumentation.ts
import { registerOTel } from '@vercel/otel'

export function register() {
  registerOTel({ serviceName: 'my-app' })
}
```

timber.js carries the OTEL context through its own ALS store (already Cloudflare-compatible, per [Platform](11-platform.md)). This sidesteps the Workers limitation around OTEL context propagation — the context manager is timber.js's ALS, not a separate OTEL-owned one.

---

## Dev Logging

In development (`timber dev`), the framework emits a structured console output for every request regardless of whether a logger is configured. Always on in dev mode. Production logger is always off in dev mode (no duplicate output).

### Format: Grouped Indented Tree

The output mirrors the execution structure of the request, with timing on every node and markers for serial vs. parallel execution. `[rsc]`/`[ssr]`/`[client]` labels show which environment each phase runs in.

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
│  │  └── requireUser()                        timber.cache HIT  <1ms
│  ├─ [rsc]  AccessGate (project)                   7ms →  8ms
│  │  ├── requireUser()                        timber.cache HIT  <1ms
│  │  └── getProject("123")                    timber.cache HIT  <1ms
│  ├─ [rsc]  ProjectPage                            8ms → 12ms
│  │  ├── getProject("123")                    timber.cache HIT  <1ms
│  │  └── getTaskCounts("123")                 timber.cache HIT  <1ms
│  └── onShellReady                                12ms
├─ [ssr]     hydration render                      13ms → 18ms
└─ ✓ 200 OK                              total    18ms
   └─ [rsc]  RecentActivity (Suspense)              ·  → 94ms  (streamed)
```

`trace_id` is always shown on the request line — a UUID when OTEL is not configured, the real OTEL trace ID when it is. When OTEL is active, clicking the ID in a terminal that supports links (or copy-pasting it) goes directly to the trace in Jaeger/Honeycomb/etc.

### Cache Annotations

```
├── getProject("123")                    timber.cache HIT   <1ms  ← warmed by handler
├── getUser()                            timber.cache MISS  43ms
├── getOrg("acme")                       React.cache  HIT   <1ms  ← deduped in render pass
```

### Slow Phase Highlighting

```typescript
// timber.config.ts
export default {
  dev: {
    slowPhaseMs: 200,  // default: 200ms
  },
  slowRequestMs: 3000,  // production threshold
}
```

### Access Check Outcomes

```
├─ [rsc]  AccessGate (authenticated)
│  └── requireUser()              → PASS
├─ [rsc]  AccessGate (project)
│  └── getProject("123")          → DENY 404  ← renders 404.tsx
```

### Server Actions

```
ACTION createTodo (app/todos/actions.ts)  trace_id: 4bf92f3577b34da6a3ce929d0e0e4736
├─ [rsc]  middleware: authMiddleware                0ms →  3ms
│  └── getUser()                              timber.cache HIT  <1ms
├─ [rsc]  schema validation (zod)                  4ms →  5ms  → PASS
├─ [rsc]  action body                              5ms → 12ms
└─ [rsc]  revalidatePath("/todos")                 12ms → 28ms
   └── ✓  RSC payload attached to response
```

### Output

Dev logging writes to `process.stderr`. Suppress with `TIMBER_DEV_QUIET=1`. Reduce to summaries with `TIMBER_DEV_LOG=summary`:

```
TIMBER_DEV_LOG=summary timber dev
# POST /dashboard/projects/123 → 200 OK  18ms  trace_id: 4bf92f35...
```

---

## Relationship to `proxy.ts`

`proxy.ts` is for request-level instrumentation the developer controls — response transformation, propagating the trace ID as a response header, custom timing. `instrumentation.ts` is for SDK initialization and error hooks. The framework logger covers framework events. All three are additive.

```typescript
// instrumentation.ts
import pino from 'pino'
import * as Sentry from '@sentry/node'
import { registerOTel } from '@vercel/otel'

export const logger = pino({ level: 'info' })

export function register() {
  registerOTel({ serviceName: 'my-app' })
}

export async function onRequestError(error, request, context) {
  Sentry.captureException(error, { extra: context })
}
```

```typescript
// app/proxy.ts — propagate trace ID to client as a response header
import { traceId } from '@timber/app/server'

export default function proxy(req: Request, next: () => Promise<Response>) {
  return next().then(res => {
    res.headers.set('X-Trace-Id', traceId())
    return res
  })
}
```

`traceId()` is always a non-empty string — the OTEL trace ID when tracing is active, a UUID otherwise. The response header is always set, no conditional needed. One identifier, propagated consistently everywhere.

---

## What the Framework Does Not Instrument

- **Individual component timings in production** — the `timber.render` span covers the full render pass as one unit. Per-component timing is dev-mode only.
- **`timber.cache` as child spans** — recorded as span events, not child spans. Keeps cardinality low.
- **React internals** — reconciliation, hydration, client navigation.
- **Application business logic** — the framework instruments its own phases only.

---

## Implementation Notes

`register()` is awaited at server startup before the request handler is registered. The server does not accept connections until it resolves.

At request start, timber.js generates a 32-char lowercase hex ID (`crypto.randomUUID().replace(/-/g, '')`) and stores it in the ALS store as the `trace_id`. If an OTEL SDK is active and creates a root span, the ALS value is immediately replaced with the OTEL trace ID — same format, different source. Either way, `traceId()` returns a non-empty string from the very first line of `proxy.ts` onward. The OTEL context itself is also stored in the ALS store (alongside `headers()`, `cookies()`, etc.), which is what enables context propagation on Cloudflare Workers without a separate OTEL-owned context manager.

The dev logger is implemented as a Vite plugin and stripped entirely from production builds. Logger and OTEL call sites are no-ops when unconfigured.

### Implementation Status

**Implemented (Phase 2d):**
- `traceId()` — per-request 32-char hex ID, ALS-backed, exported from `@timber/app/server`
- `runWithTraceId()` / `replaceTraceId()` — framework-internal ALS scope management
- `instrumentation.ts` support — `register()`, `onRequestError()`, `logger` export
- `TimberLogger` interface, `getLogger()` for framework event emission
- `Instrumentation` namespace types (`RequestInfo`, `ErrorContext`)
- Wired into the RSC entry handler as the outermost ALS scope

**Not yet implemented:**
- OTEL SDK auto-detection and `replaceTraceId()` wiring (requires span creation hook)
- Framework-emitted spans (`timber.proxy`, `timber.render`, etc.)
- Production logger integration (calling `getLogger()` at framework event points)
- Dev logging (grouped indented tree output)
- `slowRequestMs` / `slowPhaseMs` threshold warnings
- Log–trace correlation (`trace_id` + `span_id` injection)
