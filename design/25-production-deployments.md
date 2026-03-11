# Production Deployments

## Two Adapters

timber.js ships two first-party adapters. All deployment targets are covered by one of them.

**`cloudflare()`** — Cloudflare Workers and Pages. First-class, deeply integrated. Generates a Workers-compatible `_worker.ts` entry and `wrangler.jsonc`. Binds `waitUntil()` directly to `ExecutionContext.waitUntil()`. Passes through KV, D1, Durable Objects, R2, and Queues bindings. This adapter exists because Workers is architecturally different from Node — it has no file system, no `node:http`, and its own lifecycle model. The tight integration is worth the maintenance cost.

**`nitro({ preset })`** — Everything else. Nitro handles the platform-specific wiring (compression, graceful shutdown, static file serving, serverless function shape) so timber.js doesn't have to. Supported presets:

| Preset | Platform | `waitUntil()` | Notes |
|--------|----------|---------------|-------|
| `node-server` | Any Node.js host, Docker, VPS | Yes | Default. Graceful SIGTERM shutdown. |
| `bun` | Bun.serve() | Yes | Native Request/Response. |
| `vercel` | Vercel Serverless Functions | Yes | `maxDuration`, `regions` config passthrough. |
| `vercel-edge` | Vercel Edge Functions | Yes | V8 isolate, similar constraints to Workers. |
| `netlify` | Netlify Functions | No | Lambda-based. |
| `netlify-edge` | Netlify Edge Functions | Yes | Deno-based, supports `waitUntil()`. |
| `aws-lambda` | AWS Lambda (direct or via API Gateway) | No | Best-effort `waitUntil()`. |
| `deno-deploy` | Deno Deploy | Yes | Web standard APIs. |
| `azure-functions` | Azure Functions | No | Best-effort `waitUntil()`. |

### Why Not Nitro for Cloudflare?

Nitro has `cloudflare-pages` and `cloudflare-module` presets. We don't use them because:

1. **Direct binding access.** Nitro abstracts bindings behind its own storage layer. timber.js passes them through directly — `env.MY_KV`, `env.MY_DB`, etc. No abstraction in the way.
2. **`ExecutionContext` lifecycle.** timber.js binds `waitUntil()` per-request to the actual `ExecutionContext`. Nitro's lifecycle management adds unnecessary indirection.
3. **`wrangler.jsonc` generation.** timber.js generates config tailored to its output structure. Nitro generates its own, which would need post-processing.
4. **Debugging simplicity.** The generated `_worker.ts` is a thin wrapper around timber's request handler. No Nitro runtime in the critical path means fewer layers to debug in production.

### Why Not Standalone Node/Bun Adapters?

timber.js previously had separate `node.ts` and `bun.ts` adapters. They were removed because:

1. **Nitro already does this.** The `node-server` and `bun` presets handle compression, static file serving, graceful shutdown, and `waitUntil()` promise collection.
2. **Maintenance cost.** Each standalone adapter reimplemented HTTP bridging, compression negotiation, and signal handling. Nitro maintains this across 50+ presets with a much larger team.
3. **No unique value.** Unlike Cloudflare, Node and Bun don't have platform-specific APIs that benefit from tight integration. The standard `Request`/`Response` interface is sufficient.

### Community Adapters

Any package that exports a `TimberPlatformAdapter` is a valid adapter. The interface is the contract:

```typescript
interface TimberPlatformAdapter {
  name: string
  buildOutput(config: TimberConfig, buildDir: string): Promise<void>
  preview?(config: TimberConfig, buildDir: string): Promise<void>
}
```

---

## Build Pipeline → Deployable Artifact

The 5-step build sequence (RSC → SSR → Client → Manifest → Adapter) produces intermediate output in `.timber/build/`. The adapter step transforms this into a deployable artifact.

```
timber build
  ├── Step 1: RSC Build      → .timber/build/rsc/          (server component chunks, route manifest)
  ├── Step 2: SSR Build      → .timber/build/ssr/          (client component SSR chunks)
  ├── Step 3: Client Build   → .timber/build/client/       (browser bundles, CSS, assets)
  ├── Step 4: Manifest       → .timber/build/manifest.json (route→chunk mapping, CSS deps, Early Hints)
  └── Step 5: Adapter        → platform-specific output
```

### Cloudflare Output

```
.timber/deploy/
  _worker.ts          # Workers entry point — thin wrapper around timber handler
  static/             # Client assets (hashed filenames, immutable caching)
  wrangler.jsonc      # Generated config (compatibility_date, compatibility_flags, bindings)
```

### Nitro Output

Nitro produces its own output structure per preset. For `node-server`:

```
.timber/deploy/
  .output/
    server/
      index.mjs       # Node.js entry — h3 event handler bridging to timber
      chunks/          # Server chunks
    public/            # Static assets
    nitro.json         # Runtime config
```

For `vercel`:

```
.vercel/
  output/
    functions/
      index.func/
        index.mjs      # Serverless function entry
        .vc-config.json
    static/            # Static assets
    config.json        # Vercel build output config
```

---

## Caching in Production

timber.js has three caching layers. They are independent and composable.

### Layer 1: Application Cache (`timber.cache` + `"use cache"`)

Cross-request caching of data and rendered RSC payloads. Controlled entirely by the developer. See [Caching](06-caching.md) for the full API.

**Cache handler selection by deployment target:**

| Deployment | Recommended Handler | Why |
|-----------|-------------------|-----|
| Single server (VPS, Docker) | `MemoryCacheHandler` | In-process LRU. No external dependency. Fast. |
| Multi-instance (k8s, ECS) | `RedisCacheHandler` | Shared store. Tag-based invalidation propagates across instances. |
| Cloudflare Workers | `KVCacheHandler` | Workers KV. Eventually consistent (seconds). Global edge distribution. |
| Serverless (Vercel, Lambda) | `RedisCacheHandler` or `UpstashCacheHandler` | Serverless functions are ephemeral — in-process cache evaporates between invocations. Must use external store. |

**Key constraint: serverless cache is ephemeral.** A `MemoryCacheHandler` on a serverless function only lives for the duration of the function invocation (or a warm instance). For serverless deployments, always use an external cache handler. The framework does not warn about this automatically — it's a deployment topology decision.

**Singleflight is per-process.** In a multi-instance deployment, each instance coalesces independently. Two instances can both execute the same cache-miss function simultaneously. Combined with `staleWhileRevalidate`, this means at most one execution per instance per key — not one globally. For most deployments, this is fine. If global singleflight matters, use a distributed lock (Redis `SET NX`) in the cache handler.

### Layer 2: CDN / Edge Cache (HTTP `Cache-Control`)

HTTP-level caching at the CDN or reverse proxy. The developer sets `Cache-Control` headers explicitly in `proxy.ts` or `middleware.ts`. The framework does not derive cache headers automatically — this is a deliberate design decision. Automatic cache headers are a common source of stale content bugs, especially when auth is involved.

```typescript
// app/proxy.ts — global middleware
export default async function proxy(ctx: MiddlewareContext) {
  // Public marketing pages — cache at CDN for 5 minutes
  if (ctx.pathname.startsWith('/marketing/')) {
    ctx.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60')
  }

  // API routes — never cache at CDN
  if (ctx.pathname.startsWith('/api/')) {
    ctx.headers.set('Cache-Control', 'private, no-store')
  }

  // Authenticated pages — CDN must not cache
  if (ctx.pathname.startsWith('/dashboard/')) {
    ctx.headers.set('Cache-Control', 'private, no-cache')
  }
}
```

**CDN behavior varies by platform:**

- **Cloudflare** — respects `Cache-Control` on Workers responses. Static assets in `static/` are served from Cloudflare's CDN with automatic immutable caching for hashed filenames. For dynamic responses, Cloudflare caches based on `Cache-Control` unless `private` or `no-store` is set.
- **Vercel** — respects `Cache-Control`. Vercel Edge Network caches responses at the edge. `stale-while-revalidate` works as expected. Vercel also has its own data cache for ISR — timber.js does not use this.
- **Self-hosted (behind Nginx/Varnish/Fastly)** — standard HTTP caching. The developer configures the reverse proxy. timber.js' only responsibility is setting correct headers.

**Security interaction.** CDN caching of authenticated responses is the #1 production caching bug. timber.js mitigates this:
- `access.ts` runs on every request, before headers are set
- The framework does not set `Cache-Control` automatically — the developer must opt in
- Dev-mode warnings fire if a `"use cache"` component reads request-specific context

But the framework cannot prevent a developer from setting `Cache-Control: public` on a page that reads `cookies()`. That's a deployment configuration error, not a framework error.

### Layer 3: 103 Early Hints

Early Hints are generated from the build manifest at route-match time — before rendering begins. They tell the browser to start loading CSS and JS chunks while the server renders the page.

```
HTTP/1.1 103 Early Hints
Link: </assets/main-abc123.js>; rel=preload; as=script
Link: </assets/styles-def456.css>; rel=preload; as=style

HTTP/1.1 200 OK
Content-Type: text/html
...
```

Early Hints are the right tool for perceived performance in timber.js's model. Because we hold the flush until `onShellReady`, the browser would otherwise be idle during server rendering. Early Hints fill that gap — the browser fetches CSS and JS while the server works.

**Platform support:**

| Platform | 103 Early Hints |
|----------|----------------|
| Cloudflare | Yes — native support via `cf-early-hints` or `Link` header |
| Vercel | Yes — via `103` response |
| Node.js (direct) | Requires HTTP/2. `res.writeEarlyHints()` in Node 18.11+. |
| Behind Nginx | Nginx 1.25.3+ with `proxy_early_hints on` |
| Behind Fastly/Cloudfront | Varies. Check platform docs. |

The adapter is responsible for emitting Early Hints in the platform-appropriate format. The framework provides the `Link` header values from the build manifest.

### Caching Architecture Summary

```
Request
  │
  ▼
┌─────────────┐
│  CDN/Edge   │◄── Cache-Control headers (developer-set)
│  (Layer 2)  │    103 Early Hints (auto from manifest)
└──────┬──────┘
       │ cache miss
       ▼
┌─────────────┐
│   timber    │
│   server    │
│             │
│  proxy.ts   │
│  middleware  │
│  access.ts  │
│  render     │──► "use cache" → CacheHandler (Layer 1)
│             │──► timber.cache → CacheHandler (Layer 1)
│             │
└─────────────┘
```

---

## Server Deployments

### Dedicated Server (VPS, Bare Metal)

The recommended deployment for applications where you control your infrastructure and want the best performance characteristics.

```typescript
// timber.config.ts
import { nitro } from '@timber/app/adapters/nitro'

export default {
  output: 'server',
  adapter: nitro({ preset: 'node-server' }),
}
```

**Why dedicated servers are timber.js's sweet spot:**

- **No cold starts.** The server is always warm. First request to a route is as fast as the hundredth.
- **In-process cache stays warm.** `MemoryCacheHandler` accumulates across requests. On serverless, it evaporates.
- **Co-locate with your database.** Same machine or same rack. Waterfalls that take 200ms from a serverless function take 2ms from a co-located server. This compounds — a page with 5 sequential data fetches goes from 1000ms to 10ms.
- **Predictable costs.** CPU time is yours. No per-invocation billing surprises.
- **Full Node.js API.** File system, child processes, native modules, long-running connections.

**When serverless makes more sense:**

- Traffic is spiky and unpredictable (scale-to-zero matters)
- The application is read-heavy with no centralized data store (edge rendering wins)
- You need integrated platform features (Vercel preview deployments, Netlify forms)
- The team doesn't want to manage infrastructure

### Docker Deployment

The recommended container deployment uses a multi-stage build with production hardening.

**Principles:**

1. **Non-root user.** The application runs as a dedicated `timber` user. Never root.
2. **Multi-stage build.** Build dependencies (TypeScript, build tools) are not in the runtime image.
3. **Corepack for pnpm.** `corepack enable` + `corepack prepare` — no global `npm install -g pnpm`. The package manager version is locked to `packageManager` in `package.json`.
4. **Layer caching.** `package.json` and lockfile are copied before source code. pnpm store is cached via Docker BuildKit cache mounts.
5. **Slim base image.** `node:24-slim` (Debian-based). Not Alpine — native modules with C++ bindings (e.g., `better-sqlite3`, `sharp`) often fail on musl libc.
6. **Graceful shutdown.** Nitro's `node-server` preset handles `SIGTERM`. Docker sends `SIGTERM` on `docker stop` with a 10-second grace period by default.
7. **Health check.** `HEALTHCHECK` instruction for orchestrator liveness probes.
8. **Minimal runtime.** Only production dependencies + build output in the final image.

```dockerfile
# syntax=docker/dockerfile:1

# ── Stage 1: Install + Build ──
FROM node:24-slim AS build

# Enable corepack for pnpm (version from package.json packageManager field)
RUN corepack enable

WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies with BuildKit cache mount for pnpm store
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm run build

# ── Stage 2: Production Runtime ──
FROM node:24-slim AS runtime

RUN corepack enable

# Non-root user
RUN groupadd --system timber && \
    useradd --system --gid timber --create-home timber

WORKDIR /app

# Copy only production artifacts
COPY --from=build --chown=timber:timber /app/.timber/deploy/.output ./.output
COPY --from=build --chown=timber:timber /app/package.json ./

# Install production dependencies only
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile

USER timber

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
```

**.dockerignore:**

```
node_modules
.git
.timber
*.md
tests
examples
.env*
```

**docker-compose.yml for local testing:**

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    # Optional: mount .env for secrets
    # env_file: .env.production
```

### Kubernetes Considerations

- **Readiness probe:** `/` or a dedicated `/healthz` route. The health check should not hit the database — it validates the process is serving requests.
- **Liveness probe:** Same endpoint, longer interval. If the process is stuck, the orchestrator restarts it.
- **Resource limits:** Set CPU and memory limits. A timber.js server with `MemoryCacheHandler` grows memory proportional to cache size — set `maxSize` on the handler to bound it.
- **Horizontal scaling:** Use `RedisCacheHandler` when running multiple replicas. `MemoryCacheHandler` causes cache divergence across replicas.
- **Rolling updates:** Nitro's graceful shutdown ensures in-flight requests complete before the pod terminates. Set `terminationGracePeriodSeconds` to match your longest expected request.

### Cloudflare Workers

```typescript
// timber.config.ts
import { cloudflare } from '@timber/app/adapters/cloudflare'

export default {
  output: 'server',
  adapter: cloudflare(),
}
```

Deploy with `wrangler deploy`. The adapter generates `wrangler.jsonc` with sensible defaults:

- `compatibility_date`: build date (YYYY-MM-DD)
- `compatibility_flags`: `['nodejs_compat']`
- Static assets in `static/` are served via Cloudflare's CDN

**Workers-specific constraints:**

- **No file system.** `node:fs` is not available. Data must come from KV, D1, R2, or external APIs.
- **CPU time limits.** 10ms CPU time on free plan, 30s on paid. Long-running data processing should use `waitUntil()` or Queues.
- **Bundle size.** 10MB compressed for Workers, 25MB for Pages. Monitor with `wrangler deploy --dry-run`.
- **No long-running connections.** WebSockets require Durable Objects. SSE works within the CPU time limit.

**Bindings access:**

```typescript
// In a server component or middleware
import { getCloudflareBindings } from '@timber/app/adapters/cloudflare'

export default async function Page() {
  const { MY_KV, MY_DB } = getCloudflareBindings()
  const data = await MY_KV.get('key')
  // ...
}
```

### Vercel

```typescript
// timber.config.ts
import { nitro } from '@timber/app/adapters/nitro'

export default {
  output: 'server',
  adapter: nitro({
    preset: 'vercel',
    nitroConfig: {
      vercel: {
        functions: {
          maxDuration: 30,
          regions: ['iad1'],
        },
      },
    },
  }),
}
```

Vercel deployment is automatic via `vercel deploy` or git push. The Nitro adapter generates Vercel Build Output API-compatible output.

---

## Static Deployments

### `output: 'static'`

Fully built at build time. No server at request time. Every route is pre-rendered to HTML.

```typescript
// timber.config.ts
export default {
  output: 'static',
}
```

**What happens at build time:**

1. The build pipeline runs all 5 steps (RSC → SSR → Client → Manifest → Adapter)
2. Every route in the route tree is rendered to HTML
3. `middleware.ts` and `access.ts` run at build time, not request time
4. The output is a directory of HTML files + client assets

**What's included:**

- HTML files for every route (including dynamic routes via `generateParams`)
- Client JavaScript for React hydration and SPA navigation
- CSS and other assets with content hashes
- Server actions are extracted and deployed as separate API endpoints by the adapter

**What's NOT available:**

- `cookies()` and `headers()` — no request at build time. Build error if called.
- `middleware.ts` per-request logic — runs once at build time.
- `route.ts` API endpoints — no server to handle them.

### `output: 'static'` + `noJS: true`

Zero-JavaScript output. Pure HTML. No React runtime, no hydration, no SPA navigation. Links are plain `<a>` tags.

```typescript
export default {
  output: 'static',
  static: { noJS: true },
}
```

**Build errors in `noJS` mode:**

- `'use client'` → build error. No client runtime to run client components.
- `'use server'` → build error. No server to handle actions.
- `<Suspense>` → build error. No client-side resolution.

**Use cases:** Documentation sites, marketing pages, blogs where JavaScript adds no value. These sites load faster, use less bandwidth, and are more accessible.

### Static Hosting

Static output can be deployed to any static file host:

- **Cloudflare Pages** — `wrangler pages deploy .timber/deploy/`
- **Vercel** — `vercel deploy --prebuilt`
- **Netlify** — point build output to `.timber/deploy/`
- **S3 + CloudFront** — sync `.timber/deploy/` to S3 bucket
- **GitHub Pages** — copy `.timber/deploy/` to `gh-pages` branch
- **Any HTTP server** — Nginx, Apache, Caddy serving the static directory

---

## Preview

`timber preview` serves the production build locally for testing before deployment. The preview should behave identically to production — same routing, same headers, same caching behavior.

```bash
timber build
timber preview
```

**Adapter-specific preview:**

| Adapter | Preview Method | Behavior |
|---------|---------------|----------|
| Cloudflare | `wrangler dev --local` | Local Workers runtime. Accurate binding simulation. |
| Nitro (node-server) | Nitro's built-in preview | Starts the Node server from build output. |
| Nitro (vercel) | Vite preview fallback | No Vercel-specific preview. Falls back to Vite's static preview server. |
| Static | Vite preview | Serves static files with correct MIME types. |

If an adapter implements `preview()`, timber uses it. Otherwise, Vite's built-in preview server is the fallback. The fallback is sufficient for static builds but may not accurately represent serverless platform behavior.

---

## `TIMBER_RUNTIME` Environment Variable

Set automatically by the adapter at build time. Available in `instrumentation.ts` for conditional SDK initialization.

| Adapter | `TIMBER_RUNTIME` Value |
|---------|----------------------|
| Cloudflare | `'cloudflare'` |
| Nitro (node-server) | `'node-server'` |
| Nitro (bun) | `'bun'` |
| Nitro (vercel) | `'vercel'` |
| Nitro (vercel-edge) | `'vercel-edge'` |
| Nitro (other presets) | Preset name |

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.TIMBER_RUNTIME === 'node-server') {
    // Node-specific OTEL SDK
    const { NodeSDK } = await import('@opentelemetry/sdk-node')
    new NodeSDK({ /* ... */ }).start()
  }

  if (process.env.TIMBER_RUNTIME === 'cloudflare') {
    // Workers-specific tracing
    const { WorkersTracer } = await import('@timber/otel-cloudflare')
    WorkersTracer.init()
  }
}
```

---

## Production Checklist

### Before First Deploy

- [ ] **Choose your adapter.** Cloudflare for Workers. Nitro for everything else.
- [ ] **Choose your cache handler.** `MemoryCacheHandler` for single-instance. `RedisCacheHandler` for multi-instance. External store for serverless.
- [ ] **Set `Cache-Control` headers.** In `proxy.ts` or route `middleware.ts`. Never cache authenticated responses at the CDN.
- [ ] **Configure `instrumentation.ts`.** Set up error reporting and tracing for your platform.
- [ ] **Test with `timber preview`.** Verify the build output matches expectations.

### Performance

- [ ] **Co-locate server and database.** Same availability zone at minimum. Same machine if possible.
- [ ] **Use `timber.cache` for expensive queries.** With `staleWhileRevalidate: true` for high-traffic routes.
- [ ] **Use `"use cache"` for expensive renders.** Components that don't vary per-user.
- [ ] **Set CDN caching for public pages.** `Cache-Control: public, max-age=300, stale-while-revalidate=60`.
- [ ] **Verify 103 Early Hints are working.** Check browser DevTools → Network → Timing.

### Security

- [ ] **Read [Security](13-security.md).** Run through the 23-point checklist.
- [ ] **Audit `Cache-Control` headers.** No `public` caching on authenticated routes.
- [ ] **Audit `timber.cache` keys.** No user-specific data in cache keys for shared components.
- [ ] **Verify `access.ts` runs on every request.** Not bypassed by CDN caching.
- [ ] **Set CSRF protection.** Default Origin header validation is on. Don't disable it.

### Observability

- [ ] **Structured logging.** Use `instrumentation.ts` `onRequestError()` for error reporting.
- [ ] **OTEL traces.** Propagate trace context from CDN → server → database.
- [ ] **Health check endpoint.** For load balancer and orchestrator probes.
- [ ] **Monitor cache hit rates.** Both `timber.cache` (application) and CDN (HTTP).
