# timber.js — Design Documents

timber.js is a web framework built on Vite and React Server Components. It starts as a hard fork of Vinext and redirects that work toward a different set of design values.

The shortest version: **if Rails or PHP could do it, so can we.** Correct HTTP semantics, real status codes, pages that work without JavaScript, genuine middleware, and streaming only where you explicitly ask for it.

## Documents

| Document | Contents |
|----------|----------|
| [Philosophy](01-philosophy.md) | Why timber.js exists, the problem with streaming frameworks, core design values |
| [Rendering Pipeline](02-rendering-pipeline.md) | The flush point, single-pass rendering, AccessGate, parallel slots, element tree |
| [Data Fetching](03-data-fetching.md) | Components own their data, React.cache deduplication, async layouts, waterfall elimination |
| [Authorization](04-authorization.md) | `access.ts`, AccessGate, slot-level auth, composable auth functions |
| [Streaming](05-streaming.md) | Suspense rules, DeferredSuspense, the status code contract, layout Suspense footgun |
| [Caching](06-caching.md) | `timber.cache`, `"use cache"` (two spellings, one system), singleflight, output modes (`server`, `static`) |
| [Routing & Middleware](07-routing.md) | `proxy.ts`, `middleware.ts`, `<Link>`, navigation, prefetching, layout state preservation, `route.ts` API endpoints, i18n |
| [Forms & Server Actions](08-forms-and-actions.md) | `createActionClient`, ActionError, validation, revalidation, progressive enhancement, static mode actions |
| [TypeScript Integration](09-typescript.md) | Typed routes, `search-params.ts`, SearchParamCodec, `useQueryStates`, composition, ALS-backed `searchParams()` |
| [Error Handling](10-error-handling.md) | Two-phase errors, `error.tsx`, status-code files (`4xx.tsx`, `5xx.tsx`), `deny()`, `RenderError`, `redirect()` contexts |
| [Platform & Configuration](11-platform.md) | `timber.config.ts`, adapters, platform target, `waitUntil()`, dev mode, Vinext heritage |
| [Complete Examples](12-example.md) | Server-mode dashboard and public product page using the full system end-to-end |
| [Security](13-security.md) | URL canonicalization, CSRF, redirect safety, cache key integrity, cross-request isolation, testing checklist |
| [Ecosystem Compatibility](14-ecosystem.md) | Shim audit, `next/*` → timber mapping, import path strategy, ecosystem library compatibility (nuqs, next-themes) |
| [Next.js Test Triage](14-nextjs-test-triage.md) | Systematic triage of all Next.js tests, broken feature fixes, vinext vs timber.js divergence, timber.js feature testing |
| [Future: Pre-Rendering](15-future-prerendering.md) | Deferred: static shell optimization for `server` mode, `'use dynamic'`, `prerender.ts` — not in v1 |
| [Metadata](16-metadata.md) | `metadata` export, `generateMetadata()`, title templates, composition, metadata routes, error state metadata |
| [Logging & Observability](17-logging.md) | `instrumentation.ts` convention (`register`, `onRequestError`), BYOL logger, OTEL spans and trace propagation, dev console tree with timing/cache/environment visibility |
| [Build System](18-build-system.md) | Vite plugin decomposition, module resolution, virtual modules, entry generation, build pipeline, dev server HMR, file budgets |
| [Client Navigation](19-client-navigation.md) | Segment router, RSC payload handling, history stack, prefetch cache, scroll restoration, `useNavigationPending()` |
| [Content Collections & MDX](20-content-collections.md) | `timber-mdx` plugin, `@mdx-js/rollup` integration, `mdx-components.tsx`, content collections, `defineCollection()`, typed queries, build-time validation |
| [Dev Server & HMR](21-dev-server.md) | `timber-dev-server` plugin, three-environment HMR wiring, dev logging tree, dev-mode warnings, error overlay, Node↔Web conversion |
