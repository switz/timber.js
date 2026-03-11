# timber.js

> **Note:** This README was generated with the help of AI (Claude) and may not perfectly reflect the current state of the project.

A Vite-native React framework for Servers and Serverless (Vercel, Cloudflare Workers, etc.). Complete reimplementation from scratch of [Vinext](https://github.com/nicolo-ribaudo/vite-rsc-example) (Cloudflare's RSC-on-Vite implementation), redirected toward a different set of design values.

## Core Thesis

**If Rails or PHP could do it, so can we.**

Streaming-first frameworks (Next.js, Remix) commit to HTTP 200 the instant bytes start flowing — before the server knows what the page actually contains. A page that 404s returns 200. A redirect returns 200. An auth failure returns 200. The real outcome is communicated through client-side JavaScript, invisible to CDNs, search engines, curl, and APM tools.

timber.js takes a different approach: **block the flush until the shell is ready.** The server renders the page, discovers the outcome (200, 404, 302, 403), and *then* sends the status line and headers. The trade-off is ~20ms of additional server-side buffering before TTFB, in exchange for:

- **Real HTTP status codes** — 404s are 404s, redirects are 302s, auth failures are 403s
- **Pages that work without JavaScript** — no hydration required for primary content
- **No loading.tsx by default** — `<Suspense>` is opt-in at the sub-page level for slow secondary content
- **Genuine middleware** — can set headers, rewrite, redirect, and short-circuit before rendering
- **Correct caching** — CDNs and HTTP caches see real status codes, not 200-for-everything
- **Fully typed routing** — generated route types for `<Link>`, params, and navigation
- **Fully typed search params** — route-scoped `useQueryStates` with codegen overloads, powered by nuqs
- **Early Hints (103)** — client assets start loading while the server renders

Next.js often leans on *magic* that hides optimizations from the developer. Here, everything works transparently. We'd rather you write an inefficient site that you understand than a site that you don't understand. Less confusion about _where things run_ or _when they run_, more clarity into each phase of the rendering.

We adopt next's great design decisions (like routing and layouting), and drop it's backwards compatibility (pages router) in favor of looking forward. We deeply integrate searchParams fully typed. We focus on rendering full pages, rather than streaming loading states for a less anxious web experience (though you can still do that if you want/need to). We add nice features like `access.ts` gates and true `middleware.ts`. It's all built on vite for insanely fast dev-iteration and builds.

More here soon.

## Project Structure

```
packages/timber-app/       # The framework — Vite plugin + runtime
  src/
    plugins/               # Sub-plugins (shims, routing, entries, cache, fonts, mdx)
    shims/                 # next/* module reimplementations
    server/                # RSC/SSR entry handlers
    client/                # Client navigation runtime
    cache/                 # timber.cache + CacheHandler
    routing/               # File-system route scanner
    config/                # timber.config.ts loader
    adapters/              # Platform adapters (Cloudflare Workers, etc.)

design/                    # 19+ design docs — the source of truth for all behavior
tests/                     # Vitest unit tests
tests/e2e/                 # Playwright E2E tests
tests/fixtures/            # Test apps
examples/                  # User-facing demo apps
```

## Key Design Decisions

| Decision | Detail |
|----------|--------|
| Blocking flush | Single `renderToReadableStream` call, held until `onShellReady` |
| Plugin architecture | Returns array of sub-plugins, not a monolith |
| Entry modules | Real TypeScript files, not codegen strings |
| Middleware | `middleware(ctx: MiddlewareContext)` — one-arg signature, runs before render |
| Route handlers | `GET(ctx: RouteContext)` — one-arg signature |
| Authorization | Single `AccessContext` for segments and slots via `access.ts` |
| Streaming | Opt-in only — `<Suspense>` for deferred secondary content |
| File budget | No file over 500 lines |

## Getting Started

```bash
pnpm install
pnpm test                        # Vitest — full suite
pnpm test tests/plugin.test.ts   # Run a single test file
pnpm run test:e2e                # Playwright E2E tests
pnpm run typecheck               # TypeScript via tsgo
pnpm run lint                    # oxlint
```

## Design Documents

All design decisions live in [`design/`](design/README.md). Read the relevant design doc before working on any feature — the docs are the source of truth.

Key docs: [Philosophy](design/01-philosophy.md) · [Rendering Pipeline](design/02-rendering-pipeline.md) · [Routing & Middleware](design/07-routing.md) · [Streaming](design/05-streaming.md) · [Caching](design/06-caching.md) · [Build System](design/18-build-system.md)

## Current State

Early development (`v0.0.1`). Not published to npm. The design docs are substantially ahead of the implementation — they describe the target architecture, not necessarily what's built today.
