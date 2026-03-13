# timber.js — Design Documents

timber.js is a web framework built on Vite and React Server Components. It is a fresh implementation from scratch, informed by the design space explored by Vinext but with a different set of design values.

The shortest version: **if Rails or PHP could do it, so can we.** Correct HTTP semantics, real status codes, pages that work without JavaScript, genuine middleware, and streaming only where you explicitly ask for it.

## Basic Premises

- A good dedicated server will outperform the cpu of any serverless platform for most cases
  - Owning your own CPU cycles beats sharing them
  - No cold starts
  - You can place your rendering layer as close to your data store as possible - which has compounding positive effects due to waterfalls and round trips (same machine, same rack, or at least same availability zone)
  - It's often times cheaper and can scale just fine – it is more to manage and cognitive overhead, though
- Serverless still has value
  - Not all web rendering needs to hit a centralized data store
  - Sometimes edge rendering is useful
  - There are integrated advantages to serverless - scaling, durable objects, integrated verticals (r2, queues, etc.)
- The server is useful
  - Access Control
  - Full server APIs
  - Hide external API keys
  - multiple round-trips or waterfalls will outperform
  - your server is in your control, clients are not – clients have bad ISPs, crappy internet with terrible latency and connectivity
- Static is useful – it's just server-rendering at build-time
  - No JS is useful - if you don't need it, you can opt out
- A good website sits across the server and client boundary
  - Both from a UX perspective and performance
  - All web frameworks do this, even HTMX, Rails, or SPAs
    - HTMX largely pretends the client doesn't exist by giving the server full control of it
    - SPAs pretend the server doesn't exist
    - Rails asks you to serialize your client code
    - Universal SSR turns the server into a dumbed-down client (no node apis, no access control, etc.)
  - RSCs don't give one more credence than the other, they just embrace this inherent complexity and give you power to wield both
  - Embracing both worlds will lead to better outcomes in ux, dx, and performance
- The best UX is invisible to the user. But the best DX is _visible_–a framework that feels magical hides explicit control and observability. It should always be obvious to the developer what is happening and why.
  - Renders should have clarity when and where they are happening
  - Users should opt-in to performance, rather than having it done for them
  - Caching is useful, but it should be minimized unless elected into - all it does is cause confusion otherwise
- The web has become an anxious mess – largely because of initial page loading states.
  - Content layout shift is weird
  - Spinners followed by spinners followed by spinners is awful ux
  - All of this is percieved speed, not real speed. There's very little inherent value
- Streaming is useful, but the flush point is often in the wrong place
  - Moving the flush point too early just hides status codes and proper web standards
  - It's largely just percieved performance, very little _real_ performance (103 early hints are enough)
  - It's confusing for developers, crawl bots, AI agents, otel tracing, logs, general http-tooling
  - Pages load complete and with their content ready
  - It largely amounts to a micro-optimization over poorly constructed data layers – fast, performant, and low latency data layers negate most benefits (not all!) of streaming
- Open Source devs have long been anathema to making money
  - Not being profitable is just code for not being sustainable
  - Companies building open source work often have perverse (or misaligned) incentives when their product is disparate from the open source project itself
  - Just because something is 'open source', doesn't mean you shouldn't be able to capture the value you create with it
  - Making money directly has better incentives for both parties than making money indirectly (e.g. selling servers/infra/cdn changes your design decisions)
- All public sites (and most private ones) should largely work with or without javascript
  - They often render leaner and faster
  - They're more accessible to various devices and device-types
  - They tend to have fewer bugs (request-response model vs. infinite lifecycle of the client + state)
  - Generally involve fewer throughput to get the user to content when on high latency or high-packet-drop internet (e.g. flights, lower quality internet, tethering)
  - No primary-content loading states.

## Documents

| Document                                               | Contents                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Philosophy](01-philosophy.md)                         | Why timber.js exists, the problem with streaming frameworks, core design values                                                                                          |
| [Rendering Pipeline](02-rendering-pipeline.md)         | The flush point, single-pass rendering, AccessGate, parallel slots, element tree                                                                                         |
| [Data Fetching](03-data-fetching.md)                   | Components own their data, React.cache deduplication, async layouts, waterfall elimination                                                                               |
| [Authorization](04-authorization.md)                   | `access.ts`, AccessGate, slot-level auth, composable auth functions                                                                                                      |
| [Streaming](05-streaming.md)                           | Suspense rules, `deferSuspenseFor`, the status code contract, layout Suspense footgun                                                                                    |
| [Caching](06-caching.md)                               | `timber.cache`, `"use cache"` (two spellings, one system), singleflight, output modes (`server`, `static`)                                                               |
| [Routing & Middleware](07-routing.md)                  | `proxy.ts`, `middleware.ts`, `<Link>`, navigation, prefetching, layout state preservation, `route.ts` API endpoints, i18n                                                |
| [Forms & Server Actions](08-forms-and-actions.md)      | `createActionClient`, ActionError, validation, revalidation, progressive enhancement, static mode actions                                                                |
| [TypeScript Integration](09-typescript.md)             | Typed routes, `search-params.ts`, SearchParamCodec, `useQueryStates`, composition, ALS-backed `searchParams()`                                                           |
| [Error Handling](10-error-handling.md)                 | Two-phase errors, `error.tsx`, status-code files (`4xx.tsx`, `5xx.tsx`), `deny()`, `RenderError`, `redirect()` contexts                                                  |
| [Platform & Configuration](11-platform.md)             | `timber.config.ts`, adapters, platform target, `waitUntil()`, dev mode                                                                                                   |
| [Complete Examples](12-example.md)                     | Server-mode dashboard and public product page using the full system end-to-end                                                                                           |
| [Security](13-security.md)                             | URL canonicalization, CSRF, redirect safety, cache key integrity, cross-request isolation, testing checklist                                                             |
| [Ecosystem Compatibility](14-ecosystem.md)             | Shim audit, `next/*` → timber mapping, import path strategy, ecosystem library compatibility (nuqs, next-themes)                                                         |
| [Next.js Test Triage](14-nextjs-test-triage.md)        | Systematic triage of all Next.js tests, broken feature fixes, Next.js vs timber.js divergence, timber.js feature testing                                                 |
| [Future: Pre-Rendering](15-future-prerendering.md)     | Deferred: static shell optimization for `server` mode, `'use dynamic'`, `prerender.ts` — not in v1                                                                       |
| [Metadata](16-metadata.md)                             | `metadata` export, `generateMetadata()`, title templates, composition, metadata routes, error state metadata                                                             |
| [Logging & Observability](17-logging.md)               | `instrumentation.ts` convention (`register`, `onRequestError`), BYOL logger, OTEL spans and trace propagation, dev console tree with timing/cache/environment visibility |
| [Build System](18-build-system.md)                     | Vite plugin decomposition, module resolution, virtual modules, entry generation, build pipeline, dev server HMR, file budgets                                            |
| [Client Navigation](19-client-navigation.md)           | Segment router, RSC payload handling, history stack, prefetch cache, scroll restoration, `useNavigationPending()`                                                        |
| [Content Collections & MDX](20-content-collections.md) | `timber-mdx` plugin, `@mdx-js/rollup` integration, `mdx-components.tsx`, content collections, `defineCollection()`, typed queries, build-time validation                 |
| [Dev Server & HMR](21-dev-server.md)                   | `timber-dev-server` plugin, three-environment HMR wiring, dev logging tree, dev-mode warnings, error overlay, Node↔Web conversion                                        |
| [Docs & Marketing Site](22-docs-site.md)               | `@timber/docs-site` package, content collections for docs + blog, server actions demos, AI-generated content banners, Tailwind v4 styling                                |
| [Search Params](23-search-params.md)                   | nuqs integration, `useQueryStates`, route-scoped typing, composable patterns, URL key aliasing, codec bridge, `shallow: false` default                                   |
| [Fonts & Web Font Loading](24-fonts.md)                | `@timber/fonts/google`, `@timber/fonts/local`, build-time font download/subsetting, size-adjusted fallbacks, Early Hints integration, CSS variable bridging              |
| [Production Deployments](25-production-deployments.md) | Two-adapter architecture (Cloudflare + Nitro), production caching layers, Docker hardening, static deployments, preview, `TIMBER_RUNTIME`, deployment checklist          |
| [Next.js CVE Analysis](26-nextjs-cve-analysis.md)      | Security analysis of Next.js CVEs and how timber's architecture mitigates or is immune to each                                                                           |
| [Chunking Strategy](27-chunking-strategy.md)            | Client bundle splitting, vendor chunks, route-level code splitting, cache-tier optimization                                                                              |
| [npm Packaging](28-npm-packaging.md)                    | Library build strategy, tsup config, conditional exports, CLI packaging, peer deps, versioning, publishing CI plan                                                       |
| [Cookies](29-cookies.md)                                | `cookies()` read/write API, Set-Cookie merging, pipeline flow, signed cookies, secure defaults, streaming constraints                                                    |

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
- [ ] AI debugging integration (maybe via MCP)? related: https://bsky.app/profile/jovidecroock.com/post/3mgprjjzebk2z
