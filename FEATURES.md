# timber.js Feature List

Features tagged as **[novel]** (not in Next.js or Vinext), **[enhanced]** (improved over Next.js), or **[parity]** (equivalent to Next.js).

## Rendering & HTTP Semantics

- **[novel]** Real HTTP status codes — pages return actual 404/401/302/500, not always 200 ([02-rendering-pipeline.md](design/02-rendering-pipeline.md))
- **[novel]** No implicit loading states — no `loading.tsx`; `<Suspense>` is opt-in ([01-philosophy.md](design/01-philosophy.md))
- **[novel]** `deferSuspenseFor` — hold SSR stream so fast-resolving Suspense renders inline ([05-streaming.md](design/05-streaming.md))
- **[enhanced]** Streaming with correct status — flush held until shell ready ([05-streaming.md](design/05-streaming.md))

## Routing

- **[parity]** File-based routes — `app/` directory with pages, layouts, middleware, API routes ([07-routing.md](design/07-routing.md))
- **[parity]** Parallel routes (slots) — `@sidebar`, `@modal` render simultaneously within layouts ([07-routing.md](design/07-routing.md))
- **[parity]** Intercepting routes — modal pattern with soft/hard navigation split ([07-routing.md](design/07-routing.md))
- **[parity]** API routes (`route.ts`) — export `GET`, `POST`, etc. ([07-routing.md](design/07-routing.md))
- **[enhanced]** Typed routes — build-time codegen; `<Link>` type-checks href, params, searchParams ([09-typescript.md](design/09-typescript.md))
- **[parity]** Private folders — `_`-prefixed directories excluded from route and metadata discovery ([07-routing.md](design/07-routing.md))
- **[enhanced]** Per-segment middleware — `middleware.ts` per route segment, not single global ([07-routing.md](design/07-routing.md))

## Authorization & Access Control

- **[novel]** Per-segment `access.ts` — gate rendering with `deny()`, `redirect()`, or throw ([04-authorization.md](design/04-authorization.md))
- **[novel]** Middleware vs access split — lightweight token checks vs segment auth with cache sharing ([04-authorization.md](design/04-authorization.md))
- **[novel]** Graceful slot degradation — denied slots render `denied.tsx`; page unaffected ([04-authorization.md](design/04-authorization.md))

## Data Fetching & Caching

- **[novel]** `timber.cache()` — explicit cache wrapper with TTL, tags, staleWhileRevalidate ([06-caching.md](design/06-caching.md))
- **[novel]** No implicit fetch caching — bare `fetch()` is never cached ([06-caching.md](design/06-caching.md))
- **[novel]** `"use cache"` directive — component-level RSC output caching ([06-caching.md](design/06-caching.md))
- **[enhanced]** TTL + tag-based invalidation via `revalidateTag()` ([06-caching.md](design/06-caching.md))
- **[enhanced]** Pluggable cache handlers — in-memory, Redis, Cloudflare KV, or custom ([06-caching.md](design/06-caching.md))

## Search Params

- **[novel]** Typed `search-params.ts` — per-route search param definitions with Zod/nuqs codecs ([23-search-params.md](design/23-search-params.md))
- **[novel]** URL key aliasing — property names map to different URL keys ([23-search-params.md](design/23-search-params.md))
- **[novel]** Pluggable codec protocol — Zod schemas, Valibot schemas, nuqs parsers, or custom via Standard Schema ([23-search-params.md](design/23-search-params.md))
- **[enhanced]** Standard Schema support — action client and search params accept Zod, Valibot, or ArkType via `~standard` protocol ([08-forms-and-actions.md](design/08-forms-and-actions.md))
- **[enhanced]** Forms work very well with un-controlled inputs and with or without javascript. They are automatically wrapped and returned to the client if the form submission fails.
- **[enhanced]** `useQueryStates` hook — client hook syncs typed params to URL ([23-search-params.md](design/23-search-params.md))

## Metadata & SEO

- **[parity]** `metadata` export and `generateMetadata()` — static or async per page/layout ([16-metadata.md](design/16-metadata.md))
- **[parity]** Open Graph, Twitter card, robots, canonical, verification, icons ([16-metadata.md](design/16-metadata.md))
- **[parity]** Title templates — `%s | App` with nested override and `{ absolute }` escape hatch ([16-metadata.md](design/16-metadata.md))
- **[parity]** `metadataBase` — relative URL resolution for OG images and alternates ([16-metadata.md](design/16-metadata.md))
- **[parity]** Metadata routes — sitemap.xml, robots.txt, manifest.json, OG images, favicons ([16-metadata.md](design/16-metadata.md))
- **[enhanced]** Metadata always complete before flush — no partial `<head>` or client-side injection ([16-metadata.md](design/16-metadata.md))
- **[enhanced]** Error state auto-noindex — error pages automatically get `<meta name="robots" content="noindex">` ([16-metadata.md](design/16-metadata.md))

## Error Handling

- **[novel]** `deny()` — produce correct HTTP status and render status file ([10-error-handling.md](design/10-error-handling.md))
- **[novel]** Status code files — `404.tsx`, `403.tsx`, `5xx.tsx` per segment ([10-error-handling.md](design/10-error-handling.md))

## Client Navigation

- **[enhanced]** Typed `<Link>` — validates href against route map ([09-typescript.md](design/09-typescript.md))
- **[enhanced]** Client-side parallel route navigation ([19-client-navigation.md](design/19-client-navigation.md))
- **[enhanced]** `router.replace()` mode ([19-client-navigation.md](design/19-client-navigation.md))
- **[parity]** Client-side RSC navigation — `<Link>` fetches RSC payload, reconciles DOM ([19-client-navigation.md](design/19-client-navigation.md))
- **[parity]** `useSelectedLayoutSegment` hooks ([19-client-navigation.md](design/19-client-navigation.md))
- **[parity]** `permanentRedirect()` in navigation shim ([07-routing.md](design/07-routing.md))
- **[parity]** `useLinkStatus()` — per-link pending status during navigation ([19-client-navigation.md](design/19-client-navigation.md))
- **[parity]** `Link.onNavigate` — intercept navigation before routing for custom logic like view transitions ([19-client-navigation.md](design/19-client-navigation.md))

## Fonts

- **[enhanced]** Google Fonts — `import { Inter } from '@timber/fonts/google'`; build-time download and subsetting ([24-fonts.md](design/24-fonts.md))
- **[enhanced]** AST-based font config extraction with acorn parsing ([24-fonts.md](design/24-fonts.md))
- **[parity]** Local font loading ([24-fonts.md](design/24-fonts.md))

## Content & MDX

- **[novel]** Content collections — typed file-based content in `content/` with Zod schemas ([20-content-collections.md](design/20-content-collections.md))
- **[novel]** Content manifest virtual module and query API ([20-content-collections.md](design/20-content-collections.md))
- **[novel]** Content collection type generation ([20-content-collections.md](design/20-content-collections.md))

## Logging & Observability

- **[novel]** `instrumentation.ts` — `register()` at startup, `onRequestError()` for all errors ([17-logging.md](design/17-logging.md))
- **[novel]** Dev logging tree — indented request tree with timing ([17-logging.md](design/17-logging.md))
- **[novel]** Dev log modes — tree, summary, verbose ([17-logging.md](design/17-logging.md))
- **[novel]** Slow phase threshold warnings in dev mode ([17-logging.md](design/17-logging.md))
- **[enhanced]** OTEL spans — timber.access, timber.ssr, timber.action, timber.metadata ([17-logging.md](design/17-logging.md))
- **[enhanced]** Server console logs piped to browser console in development ([17-logging.md](design/17-logging.md))

## Platform & Configuration

- **[novel]** Pluggable adapters — Cloudflare Workers, Node.js, Nitro, Bun ([11-platform.md](design/11-platform.md))
- **[enhanced]** Static output mode — `output: 'static'` with static shell optimization ([11-platform.md](design/11-platform.md))
- **[parity]** CLI — `timber dev`, `timber build`, `timber preview`, `timber check` ([11-platform.md](design/11-platform.md))

## Developer Experience

- **[novel]** AST-based directive detection for `'use dynamic'`, `'use cache'`, `'use client'`, `'use server'` ([18-build-system.md](design/18-build-system.md))
- **[enhanced]** Dev warnings — detects footguns like Suspense wrapping children, deny() in Suspense ([21-dev-server.md](design/21-dev-server.md))
- **[parity]** Error overlay — browser overlay for render errors with component stack ([21-dev-server.md](design/21-dev-server.md))
- **[parity]** Dev server with HMR — Vite-based with React Fast Refresh ([21-dev-server.md](design/21-dev-server.md))
- **[novel]** Startup timing instrumentation — per-phase `performance.now()` profiling with dev-mode summary ([18-build-system.md](design/18-build-system.md))
- **[parity]** Build report — post-build route table showing per-route bundle size, route type (○ static/λ dynamic/ƒ function), and first-load JS ([18-build-system.md](design/18-build-system.md))

## Configuration

- **[enhanced]** `clientJavascript` config — disable client JS with `clientJavascript: false` or fine-tune with `{ disabled: true, enableHMRInDev: true }` to preserve HMR during development ([18-build-system.md](design/18-build-system.md))

## Build & Bundle Optimization

- **[novel]** Environment-aware shim resolution — `next/navigation` resolves to client-only shim in browser builds, preventing server code from leaking into client bundles ([18-build-system.md](design/18-build-system.md))
- **[novel]** Client bundle boundary tests — static import tracing ensures server modules never enter the browser entry dependency tree ([18-build-system.md](design/18-build-system.md))
- **[novel]** Cache-tier chunk splitting — client bundles split into vendor-react (stable across deploys) and timber runtime (stable across app changes) for optimal browser caching ([27-chunking-strategy.md](design/27-chunking-strategy.md))

## Bug Fixes from Next.js / Vinext

- **[novel]** Connection abort suppression — mid-stream page refresh doesn't trigger error boundaries; `AbortSignal` propagated through RSC/SSR, client detects page unload ([10-error-handling.md](design/10-error-handling.md))

## Shim Compatibility

- **[parity]** ALS-backed `headers()` and `cookies()` for server components ([07-routing.md](design/07-routing.md))
- **[parity]** next-intl compatibility ([07-routing.md](design/07-routing.md))
- **[parity]** next/font/\* shims redirected to timber-fonts virtual modules ([24-fonts.md](design/24-fonts.md))
- **[parity]** `server-only` / `client-only` poison pill packages — build-time error when imported in the wrong environment ([14-ecosystem.md](design/14-ecosystem.md))
