# timber.js Feature List

Features tagged as **[novel]** (not in Next.js or Vinext), **[enhanced]** (improved over Next.js), or **[parity]** (equivalent to Next.js).

## Rendering & HTTP Semantics

- **[novel]** Real HTTP status codes — pages return actual 404/401/302/500, not always 200 ([02-rendering-pipeline.md](design/02-rendering-pipeline.md))
- **[novel]** No implicit loading states — no auto-inserted `loading.tsx`; `<Suspense>` is opt-in ([01-philosophy.md](design/01-philosophy.md))
- **[novel]** `deferSuspenseFor` — hold SSR stream up to N ms so fast-resolving Suspense renders inline ([05-streaming.md](design/05-streaming.md))
- **[enhanced]** Streaming with correct status — flush held until shell ready so status code commits before stream ([05-streaming.md](design/05-streaming.md))
- **[enhanced]** 103 Early Hints — segment-level CSS/font/JS hints sent before HTML arrives ([02-rendering-pipeline.md](design/02-rendering-pipeline.md))

## Routing

- **[parity]** File-based routes — `app/` directory structure with pages, layouts, middleware, API routes ([07-routing.md](design/07-routing.md))
- **[parity]** Parallel routes (slots) — `@sidebar`, `@modal` render simultaneously within layouts ([07-routing.md](design/07-routing.md))
- **[parity]** Intercepting routes — modal pattern with soft/hard navigation split ([07-routing.md](design/07-routing.md))
- **[parity]** Config-level redirects & rewrites — declarative arrays in `timber.config.ts` ([07-routing.md](design/07-routing.md))
- **[parity]** API routes (`route.ts`) — export `GET`, `POST`, etc. with standard request/response ([07-routing.md](design/07-routing.md))
- **[enhanced]** Typed routes — build-time codegen for route map; `<Link>` type-checks href, params, searchParams ([09-typescript.md](design/09-typescript.md))
- **[enhanced]** Automatic OPTIONS — API routes auto-generate 204 OPTIONS with Allow header ([07-routing.md](design/07-routing.md))
- **[enhanced]** Per-segment middleware — `middleware.ts` per route segment, not single global middleware ([07-routing.md](design/07-routing.md))

## Authorization & Access Control

- **[novel]** Per-segment `access.ts` — route segments gate rendering with `deny()`, `redirect()`, or throw ([04-authorization.md](design/04-authorization.md))
- **[novel]** Middleware vs access clarity — explicit split between lightweight token checks and segment auth ([04-authorization.md](design/04-authorization.md))
- **[novel]** Graceful slot degradation — denied slots render `denied.tsx`; page and siblings unaffected ([04-authorization.md](design/04-authorization.md))
- **[enhanced]** Shared auth cache — `access.ts` and layouts share `React.cache` scope; auth executes once per request ([04-authorization.md](design/04-authorization.md))

## Data Fetching & Caching

- **[novel]** `timber.cache()` — explicit cache wrapper with TTL, tags, staleWhileRevalidate, key ([06-caching.md](design/06-caching.md))
- **[novel]** No implicit fetch caching — bare `fetch()` is never cached; wrap with `timber.cache()` if needed ([06-caching.md](design/06-caching.md))
- **[novel]** `"use cache"` directive — component-level RSC output caching with props as key ([06-caching.md](design/06-caching.md))
- **[enhanced]** TTL + tag-based invalidation — `revalidateTag()` and `timber.cache.invalidate()` ([06-caching.md](design/06-caching.md))
- **[enhanced]** Singleflight — cache misses coalesce so only one upstream call per key under concurrent load ([06-caching.md](design/06-caching.md))
- **[enhanced]** Pluggable cache handlers — in-memory, Redis, Cloudflare KV, or custom ([06-caching.md](design/06-caching.md))
- **[enhanced]** Middleware cache warming — prefetch data in middleware so render-pass hits warm cache ([07-routing.md](design/07-routing.md))
- **[parity]** Async server components own data — no `getServerSideProps` or loaders ([03-data-fetching.md](design/03-data-fetching.md))

## Search Params

- **[novel]** Typed `search-params.ts` — per-route search param definitions with Zod/nuqs codecs ([23-search-params.md](design/23-search-params.md))
- **[novel]** URL key aliasing — property names map to different URL keys (e.g. `search` → `?q=`) ([23-search-params.md](design/23-search-params.md))
- **[novel]** Pluggable codec protocol — Zod schemas, nuqs parsers, or custom codecs ([23-search-params.md](design/23-search-params.md))
- **[enhanced]** Composable search params — `.extend()` and `.pick()` for shared param bases across routes ([23-search-params.md](design/23-search-params.md))
- **[enhanced]** `useQueryStates` hook — client hook syncs typed params to URL; triggers server navigation by default ([23-search-params.md](design/23-search-params.md))

## Forms & Server Actions

- **[novel]** Single-roundtrip revalidation — `revalidatePath()` piggybacks RSC payload in action response ([08-forms-and-actions.md](design/08-forms-and-actions.md))
- **[enhanced]** Action client middleware — `createActionClient` with auth/validation middleware and typed `ActionError` ([08-forms-and-actions.md](design/08-forms-and-actions.md))
- **[enhanced]** Schema-based input validation — `.schema(ZodType)` with typed `result.validationErrors` ([08-forms-and-actions.md](design/08-forms-and-actions.md))
- **[enhanced]** Relative-only redirects — `redirect('/path')` accepted; external URLs rejected unless via `redirectExternal(url, allowList)` ([08-forms-and-actions.md](design/08-forms-and-actions.md))
- **[enhanced]** Configurable FormData limits — default 1MB body, 10MB upload, 100 fields; tunable in config ([08-forms-and-actions.md](design/08-forms-and-actions.md))
- **[parity]** Server actions — `'use server'` functions called from forms and client code ([08-forms-and-actions.md](design/08-forms-and-actions.md))
- **[parity]** Progressive form enhancement — forms work without JS via standard POST ([08-forms-and-actions.md](design/08-forms-and-actions.md))

## Error Handling

- **[novel]** `deny()` — call `deny(401)`, `deny(404)`, etc. to produce correct HTTP status and render status file ([10-error-handling.md](design/10-error-handling.md))
- **[novel]** Status code files — `404.tsx`, `403.tsx`, `429.tsx`, `5xx.tsx` per segment ([10-error-handling.md](design/10-error-handling.md))
- **[novel]** Format-aware status files — `.tsx`, `.mdx`, or `.json` for different consumers ([10-error-handling.md](design/10-error-handling.md))
- **[novel]** Shell opt-out — status files export `shell = false` to render without layouts ([10-error-handling.md](design/10-error-handling.md))
- **[enhanced]** `RenderError` with typed context — `throw new RenderError('CODE', { data })` passes structured data to error boundary ([10-error-handling.md](design/10-error-handling.md))
- **[enhanced]** Error boundary per segment — wraps page content inside layouts, preserving layout chrome ([10-error-handling.md](design/10-error-handling.md))

## Client Navigation

- **[enhanced]** Segment tree diffing — server skips re-rendering sync layouts already mounted on client ([19-client-navigation.md](design/19-client-navigation.md))
- **[enhanced]** History payload cache — RSC payloads cached by URL; back/forward is instant ([19-client-navigation.md](design/19-client-navigation.md))
- **[enhanced]** Prefetch on hover — `<Link prefetch>` fetches RSC on hover, opt-in not automatic ([19-client-navigation.md](design/19-client-navigation.md))
- **[enhanced]** `useNavigationPending()` — returns true while RSC fetch is in flight ([19-client-navigation.md](design/19-client-navigation.md))
- **[enhanced]** Typed `<Link>` href — validates against route map with per-route params and searchParams ([09-typescript.md](design/09-typescript.md))
- **[parity]** Client-side RSC navigation — `<Link>` intercepts clicks, fetches RSC payload, reconciles DOM ([19-client-navigation.md](design/19-client-navigation.md))
- **[parity]** Layout state preservation — sync layouts stay mounted across navigations ([19-client-navigation.md](design/19-client-navigation.md))
- **[parity]** Scroll restoration — forward scrolls to top; back/forward restores position ([19-client-navigation.md](design/19-client-navigation.md))

## Metadata & SEO

- **[enhanced]** Metadata composition — root→page merge in single render pass; shares `React.cache` with page ([16-metadata.md](design/16-metadata.md))
- **[enhanced]** ImageResponse — Rust-based OG image generation that works on Cloudflare Workers ([16-metadata.md](design/16-metadata.md))
- **[parity]** Static & dynamic metadata — export `metadata` object or `generateMetadata()` function ([16-metadata.md](design/16-metadata.md))
- **[parity]** Title templates — `title: { template: '%s | My App' }` in layouts ([16-metadata.md](design/16-metadata.md))
- **[parity]** Metadata routes — `sitemap.ts`, `robots.ts`, `manifest.json`, `icon.tsx`, `opengraph-image.tsx` ([16-metadata.md](design/16-metadata.md))

## Fonts

- **[enhanced]** Google Fonts — `import { Inter } from '@timber/fonts/google'`; build-time download and subsetting ([24-fonts.md](design/24-fonts.md))
- **[enhanced]** Font Early Hints — fonts auto-included in 103 Early Hints and preload links ([24-fonts.md](design/24-fonts.md))
- **[enhanced]** Size-adjusted fallbacks — metric-matched fallback fonts eliminate CLS during swap ([24-fonts.md](design/24-fonts.md))
- **[enhanced]** CSS variable export — `variable: '--font-sans'` for Tailwind v4 integration ([24-fonts.md](design/24-fonts.md))
- **[parity]** Local font loading — same pipeline as Google Fonts for local `.woff2` files ([24-fonts.md](design/24-fonts.md))

## Content & MDX

- **[novel]** Content collections — typed file-based content in `content/` with Zod schemas ([20-content-collections.md](design/20-content-collections.md))
- **[novel]** Collection transforms — `transform` function for computed fields; `compileMDX()` for MDX collections ([20-content-collections.md](design/20-content-collections.md))
- **[novel]** Primary vs secondary content — explicit content importance modeling for Suspense placement ([20-content-collections.md](design/20-content-collections.md))
- **[enhanced]** MDX pages as RSC — `.mdx` files are server components with zero client JS by default ([20-content-collections.md](design/20-content-collections.md))
- **[enhanced]** MDX frontmatter as metadata — frontmatter fields auto-treated as `metadata` export ([20-content-collections.md](design/20-content-collections.md))
- **[parity]** Custom MDX components — `mdx-components.tsx` provides component mappings ([20-content-collections.md](design/20-content-collections.md))

## Logging & Observability

- **[novel]** `instrumentation.ts` — `register()` at startup, `onRequestError()` for all errors ([17-logging.md](design/17-logging.md))
- **[novel]** Trace ID always present — 32-char hex ID per request via `traceId()` ([17-logging.md](design/17-logging.md))
- **[novel]** Dev logging tree — indented request tree showing proxy→middleware→render→ssr with timing ([17-logging.md](design/17-logging.md))
- **[novel]** Dev log modes — `TIMBER_DEV_LOG=tree|summary|verbose`, `TIMBER_DEV_QUIET=1` ([17-logging.md](design/17-logging.md))
- **[enhanced]** OTEL SDK integration — vendor-neutral with automatic span context via ALS ([17-logging.md](design/17-logging.md))
- **[enhanced]** Framework event logging — structured events for request lifecycle, slow requests, cache misses ([17-logging.md](design/17-logging.md))

## Platform & Configuration

- **[novel]** Pluggable adapters — Cloudflare Workers, Nitro (Node/Bun/Vercel/Netlify), or custom ([11-platform.md](design/11-platform.md))
- **[novel]** `waitUntil()` — post-response work that maps to Workers `ctx.waitUntil()` ([11-platform.md](design/11-platform.md))
- **[novel]** Slow request threshold — `slowRequestMs` and `slowPhaseMs` highlight performance issues ([17-logging.md](design/17-logging.md))
- **[enhanced]** Output modes — `output: 'server'` or `'static'`; optional `noJS: true` for zero JavaScript ([11-platform.md](design/11-platform.md))
- **[enhanced]** Configurable CORS & CSP — `allowedOrigins` in config; auto-derives from Host header ([08-forms-and-actions.md](design/08-forms-and-actions.md))

## Developer Experience

- **[novel]** Static analyzability enforcement — search params, fonts, content collections validated at build time ([09-typescript.md](design/09-typescript.md))
- **[enhanced]** Dev warnings — framework detects footguns: Suspense wrapping children, deny() in Suspense, slow slots ([21-dev-server.md](design/21-dev-server.md))
- **[parity]** Dev server with HMR — Vite-based with React Fast Refresh and RSC invalidation ([21-dev-server.md](design/21-dev-server.md))
- **[parity]** Error overlay — browser overlay for render errors with component stack ([21-dev-server.md](design/21-dev-server.md))
