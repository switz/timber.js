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
| [Docs & Marketing Site](22-docs-site.md) | `@timber/docs-site` package, content collections for docs + blog, server actions demos, AI-generated content banners, Tailwind v4 styling |
| [Search Params](23-search-params.md) | nuqs integration, `useQueryStates`, route-scoped typing, composable patterns, URL key aliasing, codec bridge, `shallow: false` default |
| [Fonts & Web Font Loading](24-fonts.md) | `@timber/fonts/google`, `@timber/fonts/local`, build-time font download/subsetting, size-adjusted fallbacks, Early Hints integration, CSS variable bridging |

## Future Concerns

We don't need to create docs for these now but future things that would be nice to add

- [ ] Intercepted routes
- [ ] Route groups
- [ ] More granular/proper route segment configs
- [ ] Params serializing/deserializing similar to our searchParams integration
- [ ] Built in support for svg sprite maps (for icons and otherwise), based on sly
- [ ] Built in support for authentication libraries like better-auth
- [ ] Open Graph image generation with takumi rs, fully integrated w/ cache busting
- [ ] Cross-deployment/build server action encryption keys
- [ ] Version skew management somehow, for both assets and actions
- [ ] Public ENV vars with a key prefix
- [ ] Built-in image optimization pipeline (resizing, format conversion, CDN-aware caching)
- [ ] Dev overlay w/ RSC aware stack traces
- [ ] better/proper i18n localization story
- [ ] preview deployments?
- [ ] CLI scaffolding and create-timber-app
- [ ] built-in sitemap/robots generation
- [ ] structure logging/log drains
- [ ] comprehensive framework-integrated feature flags
- [ ] monorepo support
- [ ] content security policies
- [ ] Full text search integration, perhaps with turbopuffer or alternative vector based search?
- [ ] Better story around async (client) react, transitions, and so on
- [ ] Unified API for fetching data for a page? all wrapped around react.cache? like `route.fetch<routetype>()` in a file called `loader.ts` - this lets you fetch it from anywhere and it'll de-duplicate the data across `access`/metadata and so on
