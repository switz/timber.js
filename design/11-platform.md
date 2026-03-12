# Platform & Configuration

## `timber.config.ts`

Project-wide configuration. Lives at the root of the project.

```ts
// timber.config.ts
export default {
  // 'server' | 'static'
  // Default: 'server'
  output: 'server',
};

// static with zero JavaScript
export default {
  output: 'static',
  static: { noJS: true },
};
```

| Option                  | Server required | Client JS                              | Server Actions               |
| ----------------------- | --------------- | -------------------------------------- | ---------------------------- |
| `server`                | Yes             | Yes                                    | Yes                          |
| `static`                | No              | Yes (hydration + SPA nav)              | Split deployment via adapter |
| `static` + `noJS: true` | No              | None (`'use client'` is a build error) | Build error                  |

In `static` mode, `middleware.ts` files run at build time only — there is no server to run them at request time. Server actions are extracted and deployed as separate API endpoints by the adapter (see [Forms & Server Actions](08-forms-and-actions.md#server-actions-in-static-mode)). With `noJS: true`, `'use server'` is also a build error.

An opt-in static shell optimization within `server` mode (`'use dynamic'`, `prerender.ts`) is designed but deferred to a later phase. See [Future: Pre-Rendering](15-future-prerendering.md).

The adapter and cache handler are also specified in `timber.config.ts`:

```ts
import { cloudflare } from '@timber/app/adapters/cloudflare';
import { MemoryCacheHandler } from '@timber/app/cache';

export default {
  output: 'server',
  adapter: cloudflare(),
  cacheHandler: new MemoryCacheHandler(), // default, pluggable for Redis/KV/etc.
};
```

---

## Adapters

### The Adapter Interface

timber.js defines a formal adapter interface. An adapter is responsible for transforming the build output into a deployable artifact for a specific platform.

```ts
interface TimberPlatformAdapter {
  name: string;

  // Transform the build output for the target platform.
  // Called at the end of `timber build`.
  buildOutput(config: TimberConfig, buildDir: string): Promise<void>;

  // Optional: start a local preview server for the built output.
  // Falls back to the built-in Node.js preview server if not provided.
  preview?(config: TimberConfig, buildDir: string): Promise<void>;
}
```

Adapters are small. They receive the build output directory and transform or copy it into whatever shape the platform expects. The request handling, rendering pipeline, and routing are platform-agnostic — adapters wire the platform's incoming request format to timber.js' standard `Request`/`Response` handler.

### First-Party Adapters

timber.js ships exactly two adapters. See [Production Deployments](25-production-deployments.md) for the full rationale.

**`@timber/app/adapters/cloudflare`** — Cloudflare Workers and Pages. First-class, deeply integrated. Generates `wrangler.jsonc`, wraps the request handler in a Workers-compatible entry point, and passes through KV/D1/DO/R2/Queues bindings directly. This adapter exists because Workers is architecturally different from Node — it has no file system, no `node:http`, and its own lifecycle model.

**`@timber/app/adapters/nitro`** — Everything else. Node.js (Docker, VPS), Bun, Vercel, Netlify, AWS Lambda, Deno Deploy, Azure Functions. Nitro handles platform-specific wiring (compression, graceful shutdown, static file serving, serverless function shape).

```ts
import { nitro } from '@timber/app/adapters/nitro';

export default {
  output: 'server',
  adapter: nitro({ preset: 'vercel' }), // Vercel serverless
  // adapter: nitro({ preset: 'node-server' }), // Docker, VPS, bare metal
  // adapter: nitro({ preset: 'bun' }),          // Bun.serve()
};
```

### Community Adapters

Any package that exports a `TimberPlatformAdapter` is a valid adapter. The interface is the contract — timber.js does not need to know about the adapter at framework development time.

---

## Platform Target

Standard Web APIs first: `Request`, `Response`, `ReadableStream`, `crypto`. Node.js, Bun, Deno, and Cloudflare Workers are all viable targets.

`AsyncLocalStorage` (`node:async_hooks`) is used narrowly — for `headers()`, `cookies()`, `params`, and `searchParams()`. ALS is active for the entire request lifecycle: `proxy.ts`, `middleware.ts`, the React render pass, and server actions all run within the ALS scope. We do not expand ALS usage beyond these request-context accessors. The narrow existing surface stays narrow.

**This narrow scope is a security decision.** Some frameworks use a global `_fallbackState` object when `ALS.getStore()` returns `undefined` (e.g., on Cloudflare Workers). Concurrent requests sharing that fallback can cause cross-request state pollution — User A could read User B's cookies, headers, and session data. timber.js has no global fallback. If the ALS store is unavailable, the call fails with an error rather than silently returning shared state. `React.cache` provides per-request, per-render-pass scoping within the render tree.

### `waitUntil()`

`waitUntil()` extends the request lifecycle to perform work after the response has been sent. It follows the web standard `ExtendableEvent.waitUntil()` API — the promise passed to `waitUntil()` keeps the runtime alive until it settles, without blocking the response.

```typescript
import { waitUntil } from '@timber/app/server'

// In middleware:
export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  waitUntil(analytics.track('page_view', { url: ctx.req.url }))
}

// In a server component:
async function Dashboard() {
  waitUntil(log.info('dashboard rendered'))
  return <div>...</div>
}

// In a server action:
export async function updateProfile(formData: FormData) {
  'use server'
  await db.users.update(formData)
  waitUntil(audit.log('profile_updated'))
  return revalidatePath('/profile')
}
```

`waitUntil()` accepts a promise. The response is not blocked — the promise runs after the response stream closes. Multiple `waitUntil()` calls within the same request are collected; the runtime stays alive until all promises settle. If a `waitUntil()` promise rejects, the error is logged but does not affect the already-sent response.

On Cloudflare Workers, `waitUntil()` maps directly to `ctx.waitUntil()`. On Node.js, the framework keeps the request context alive until all promises settle. On platforms without lifecycle extension, `waitUntil()` promises run best-effort — they execute but may be terminated if the runtime shuts down immediately after the response.

**Startup warning for unsupported adapters.** If the configured adapter does not support `waitUntil()`, the framework emits a single `warn`-level log during the `register()` phase (before the first request is handled):

```
[timber] warn: The configured adapter does not support waitUntil(). Calls to waitUntil() will run best-effort and may be terminated before completion.
```

This warning appears once at startup, not per-call. It is not a build error — `waitUntil()` is still callable, but the reliability guarantee doesn't hold on this platform.

`waitUntil()` is callable from handlers, server components, and server actions. It uses the same ALS context as `headers()` and `cookies()` — scoped to the current request.

---

## Relationship to Vinext

timber.js is a fresh implementation, not a fork of Vinext. However, it operates in the same design space (Vite + RSC) and takes inspiration from concepts Vinext explored. Where applicable, we monitor Vinext and Next.js upstream for bug fixes and security patches that may apply to the same vulnerability classes in our independent codebase.

**What timber.js shares conceptually** (reimplemented independently):

- The Vite plugin architecture pattern and three-environment model (RSC/SSR/browser)
- `next/*` shim approach for ecosystem library compatibility
- `waitUntil()` — maps directly to `ExtendableEvent.waitUntil()` on Cloudflare, framework-managed on Node.js

**Where timber.js intentionally diverges:**

- No ISR, no patched `fetch`, no implicit caching — replaced by explicit `timber.cache` and `"use cache"`
- No pages router — App Router only
- `proxy.ts` for global middleware + per-route `middleware.ts` (not a single global `middleware.ts`)
- Flush held until `onShellReady` for correct HTTP semantics

---

## Vite Plugin Architecture

### Plugin Decomposition

The main `timber()` export returns an array of Vite plugins. Each sub-plugin has a focused responsibility:

| Plugin           | Responsibility                                                            |
| ---------------- | ------------------------------------------------------------------------- |
| `timber-shims`   | Resolves `next/*` and `@timber/app/*` imports to shim files               |
| `timber-routing` | Scans `app/` directory, generates virtual route modules                   |
| `timber-entries` | Generates RSC/SSR/browser entry virtual modules                           |
| `timber-cache`   | Transforms `"use cache"` directives into `registerCachedFunction()` calls |
| `timber-fonts`   | Google and local font handling (ported from `next/font` shim)             |
| `timber-mdx`     | Auto-detects `.mdx` files and registers `@mdx-js/rollup`                  |

The core `timber()` function coordinates sub-plugins via shared state (a closure-scoped context object). Each sub-plugin is a standard Vite plugin that registers its own hooks.

```ts
// packages/timber-app/src/index.ts
export function timber(config?: TimberConfig): Plugin[] {
  const ctx = createPluginContext(config);
  return [
    timberShims(ctx),
    timberRouting(ctx),
    timberEntries(ctx),
    timberCache(ctx),
    timberFonts(ctx),
    timberMdx(ctx),
  ];
}
```

### Virtual Module Strategy

Virtual modules are used for generated code (route manifests, entry points, config). Resolution requires careful handling across Vite's three environments:

- **`\0` prefix** — Vite convention for virtual module IDs. Prevents file system lookup. Required for virtual modules in the client environment where `import-analysis` runs.
- **Root prefix in build** — Vite prefixes virtual module IDs with the project root path when resolving SSR build entries. The `resolveId` hook must handle both `virtual:timber-entry` and `<root>/virtual:timber-entry`.
- **Absolute paths** — All imports within virtual modules use absolute paths. Virtual modules have no real file location, so relative imports have no meaning.

### Entry Generation

Entry modules are **real TypeScript files** with dynamic imports configured via Vite's `define` or virtual config modules. NOT string template codegen.

```typescript
// packages/timber-app/src/server/rsc-entry.ts (real file, not generated string)
import { createRequestHandler } from './request-handler';
import routeManifest from 'virtual:timber-route-manifest';

export default createRequestHandler(routeManifest);
```

The route manifest is a virtual module generated by `timber-routing`. The entry file itself is a real TypeScript file that imports the virtual module. This avoids the string codegen antipattern (thousands of lines of template strings producing JavaScript) and provides proper type checking, source maps, and IDE support.

### Three-Environment Model

Vite maintains three separate module graphs with separate module instances:

| Environment | Purpose                                                                 | Module graph                                                          |
| ----------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| RSC         | Server components, `"use server"` actions, `access.ts`, `middleware.ts` | Server-only. No DOM APIs. `React.cache` active during render.         |
| SSR         | Client component hydration markup                                       | Server-side render of `"use client"` components. Receives RSC stream. |
| Browser     | Client runtime                                                          | Runs in the browser. Hydration, navigation, form interception.        |

State passing between RSC and SSR happens via `handleSsr(rscStream, navContext)`. Per-request state (pathname, searchParams, params, headers, cookies) is explicitly passed — the environments do NOT share module instances.

---

## CLI

The `timber` CLI is the developer-facing entry point for all framework commands.

| Command          | Description                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timber dev`     | Start the Vite-based dev server with HMR                                                                                                              |
| `timber build`   | Production build — runs the RSC/SSR/client multi-environment build pipeline                                                                           |
| `timber preview` | Serve the production build locally via the adapter's `preview()` method (falls back to built-in Node.js preview server)                               |
| `timber check`   | Type-check + run the framework's static analysis (route map codegen, `search-params.ts` analyzability, unsupported config detection) without building |

All commands accept `--config <path>` to specify an alternative `timber.config.ts` location.

---

## Environment Variables

All `TIMBER_*` variables are framework-owned. Application-level env vars are the developer's concern.

| Variable           | Default  | Description                                                                                                                                                        |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TIMBER_RUNTIME`   | `'node'` | The server runtime. Set by adapters at build time: `'node'`, `'bun'`, `'cloudflare'`. Used in `instrumentation.ts` to conditionally import platform-specific SDKs. |
| `TIMBER_DEV_QUIET` | unset    | Set to `1` to suppress dev console output entirely.                                                                                                                |
| `TIMBER_DEV_LOG`   | `'tree'` | Dev log verbosity. `'tree'` (default) for full indented tree, `'summary'` for one-line-per-request.                                                                |

`TIMBER_RUNTIME` is set automatically by the adapter — developers do not set it manually in normal usage. It is available in `instrumentation.ts` `register()` for conditional SDK initialization (e.g., `@opentelemetry/sdk-node` is Node-only).

---

## Dev Mode

`timber dev` starts a Vite-based dev server. The following behaviors are implementation details rather than architectural decisions, but are documented here for completeness:

- **Middleware re-runs on HMR.** When a `middleware.ts` file changes, the next request re-runs the middleware. This is a resolved design decision.
- **Vite HMR for components.** Server components, client components, layouts, and pages use Vite's existing HMR infrastructure via the three-environment model (RSC/SSR/browser).
- **Dev-mode warnings.** The framework emits warnings in dev mode for common footguns:
  - `<Suspense>` wrapping `{children}` in a layout
  - `cookies()`/`headers()` called during a static build pass
  - Slot access calling `redirect()` (only `deny()` is valid in slot access)
  - `deny()`/`redirect()` called inside a post-flush `<Suspense>` boundary
  - `"use cache"` component with request-specific props
  - Slot resolved slower than `slowPhaseMs` without a `<Suspense>` wrapper: `"slot @admin resolved in 847ms and is not wrapped in <Suspense>. Consider wrapping to avoid blocking the flush."`
- **Error overlay.** Dev-mode errors display in a browser overlay (inherited from Vite's error overlay infrastructure). Render-phase errors show the component stack. Handler-phase errors show the handler file and stack trace.
