# Build System

## Plugin Architecture

The `timber()` Vite plugin export returns an array of sub-plugins. Each sub-plugin registers its own Vite hooks and has a focused responsibility. Shared state is passed via a closure-scoped context object.

```ts
import { timber } from '@timber/app'

export default defineConfig({
  plugins: [timber()],
})
```

### Sub-Plugin Responsibilities

| Plugin | Hooks | Responsibility |
|--------|-------|---------------|
| `timber-root-sync` | `configResolved` | Syncs `ctx.root` and `ctx.appDir` with Vite's resolved root (must be first) |
| `timber-shims` | `resolveId`, `load` | Resolves `next/*` and `@timber/app/*` imports to shim implementations |
| `timber-routing` | `configureServer`, `buildStart`, `resolveId`, `load` | Scans `app/` directory, builds route tree, generates virtual route manifest |
| `timber-entries` | `resolveId`, `load` | Generates RSC/SSR/browser entry virtual modules |
| `timber-cache` | `transform` | Transforms `"use cache"` directives into `registerCachedFunction()` calls |
| `timber-static-build` | build hooks | Handles static output mode builds |
| `timber-dynamic-transform` | `transform` | Transforms dynamic route conventions |
| `timber-fonts` | `resolveId`, `load`, `transform` | Google and local font handling (ported from `next/font`) |
| `timber-mdx` | `config`, `buildStart` | Auto-detects `.mdx` files, registers `@mdx-js/rollup`, finds `mdx-components.tsx` |
| `timber-content` | `resolveId`, `load`, `buildStart`, `configureServer` | Scans `content/` directory, validates schemas, generates content manifest virtual module, generates types |
| `timber-dev-server` | `configureServer` | Dev request handling — routes requests through the timber pipeline (must be last) |

```ts
// packages/timber-app/src/index.ts
export function timber(config?: TimberUserConfig): Plugin[] {
  const ctx = createPluginContext(config)
  return [
    timberRootSync(ctx),         // must be first — syncs ctx with Vite's resolved root
    timberShims(ctx),
    timberRouting(ctx),
    timberEntries(ctx),
    timberCache(ctx),
    timberStaticBuild(ctx),
    timberDynamicTransform(ctx),
    timberFonts(ctx),
    timberMdx(ctx),
    timberContent(ctx),
    timberDevServer(ctx),        // must be last — see 21-dev-server.md
  ]
}
```

### Shared Plugin Context

The context object is created once and shared across all sub-plugins via closure. It holds:

- `root` and `appDir` — synced with Vite's resolved root by `timber-root-sync`
- Resolved `timber.config.ts` values
- The scanned route tree (populated by `timber-routing`, consumed by `timber-entries`)
- The shim map (populated by `timber-shims`)
- Build manifest data (accumulated during build, consumed by adapters)

**Root synchronization:** The initial context uses `process.cwd()` as the project root, but Vite may resolve a different root (e.g., when `--config` points to a subdirectory or Vite's `root` config option is set). The `timber-root-sync` plugin runs first and updates `ctx.root` and `ctx.appDir` in `configResolved` to match Vite's actual root. Without this, the route scanner and other plugins look in the wrong directory.

Sub-plugins communicate through the context — not through Vite's plugin API or global state.

---

## Module Resolution

### Shim Map

`timber-shims` maintains a map from `next/*` import specifiers to timber.js shim file paths:

```
next/link        → packages/timber-app/src/shims/link.ts
next/image       → packages/timber-app/src/shims/image.ts
next/navigation  → packages/timber-app/src/shims/navigation.ts
next/headers     → packages/timber-app/src/shims/headers.ts
next/font/google → \0@timber/fonts/google (timber-fonts virtual module)
```

The `resolveId` hook intercepts these imports and redirects to the shim files. The `.js` extension is stripped before matching — libraries like `nuqs` import `next/navigation.js` with an explicit extension.

### Environment-Aware Shim Resolution

Some shims (notably `next/navigation`) export both client hooks and server functions. In the RSC and SSR environments, both are needed. In the client (browser) environment, server functions like `redirect()` and `deny()` would pull `server/primitives.ts` into the browser bundle.

To prevent this, `timber-shims` checks `this.environment.name` in `resolveId` and resolves `next/navigation` to a client-only shim (`navigation-client.ts`) in the browser environment. The client-only shim:

- Re-exports all client hooks (`useRouter`, `usePathname`, `useSearchParams`, etc.)
- Exports `RedirectType` (safe enum, no server dependency)
- Exports stub functions for `redirect()`, `notFound()`, `permanentRedirect()` that throw helpful errors if accidentally called from client code

```
next/navigation (RSC/SSR) → shims/navigation.ts (full — client hooks + server functions)
next/navigation (client)  → shims/navigation-client.ts (client hooks only)
```

### `@timber/app/*` Subpath Resolution

`@timber/app/server`, `@timber/app/client`, `@timber/app/cache`, and `@timber/app/search-params` resolve to their respective entry files. These are real files, not virtual modules.

---

## Virtual Modules

Virtual modules are generated code with no corresponding file on disk. They use the `virtual:timber-*` prefix convention.

| Virtual Module | Generated By | Contents |
|----------------|-------------|----------|
| `virtual:timber-route-manifest` | `timber-routing` | Route tree with segment metadata, file paths, param shapes |
| `virtual:timber-rsc-entry` | `timber-entries` | RSC environment entry — imports route manifest, creates request handler |
| `virtual:timber-ssr-entry` | `timber-entries` | SSR environment entry — receives RSC stream, hydrates client components |
| `virtual:timber-browser-entry` | `timber-entries` | Browser entry — client navigation runtime, hydration bootstrap |
| `virtual:timber-config` | `timber-entries` | Resolved config values needed at runtime (output mode, feature flags) |

### Resolution Quirks

Virtual modules require special handling across Vite's environments:

**Root prefix in build:** Vite prefixes virtual module IDs with the project root when resolving SSR build entries. The `resolveId` hook handles both `virtual:timber-rsc-entry` and `<root>/virtual:timber-rsc-entry`.

**`\0` prefix in client environment:** The RSC plugin generates browser entry imports using already-resolved `\0`-prefixed IDs. Vite's `import-analysis` cannot resolve these. Fix: strip the `\0` prefix before matching in `resolveId`.

**Absolute paths required:** Virtual modules have no file location. All imports within virtual module `load` output must use absolute paths. Relative imports fail because there is no directory to resolve from.

---

## Entry Generation

Entry modules are **real TypeScript files** with dynamic imports configured via virtual config modules. This is NOT string template codegen.

### Why Not Codegen

Some RSC-on-Vite frameworks generate entry modules as template strings — thousands of lines of string concatenation producing JavaScript. This approach has critical problems:

- No type checking on generated code
- No source maps — errors point to the generated string, not the source
- No IDE support (autocompletion, go-to-definition)
- Extremely fragile — a missing quote or bracket in a template breaks silently

timber.js uses real TypeScript files that import virtual modules for the dynamic parts:

```typescript
// packages/timber-app/src/server/rsc-entry.ts (real file)
import { createRequestHandler } from './request-handler'
import routeManifest from 'virtual:timber-route-manifest'

export default createRequestHandler(routeManifest)
```

The route manifest virtual module contains the route tree data. The entry file contains the logic. Both are separately typed and testable.

### Entry Files

**RSC Entry** (`rsc-entry.ts`):
- Imports the route manifest and creates the request handler via `createPipeline`
- Builds a `RouteMatcher` from the manifest tree (see `server/route-matcher.ts`)
- Implements the renderer: loads page/layout components along the matched segment chain, resolves metadata (static `metadata` exports and `generateMetadata`), builds the React element tree, and renders via `renderToReadableStream`
- Catches `DenySignal` (from `deny()`) during render to produce the correct HTTP status
- Injects resolved metadata (`<title>`, `<meta>`) into the HTML stream before `</head>`
- Exports a `default` function that handles `Request → Response`

**SSR Entry** (`ssr-entry.ts`):
- Receives the RSC stream from the RSC entry via `handleSsr(rscStream, navContext)`
- Renders client components to HTML using `renderToReadableStream`
- Passes per-request state (pathname, params, searchParams) across the environment boundary

**Browser Entry** (`browser-entry.ts`):
- Bootstraps React hydration
- Initializes the client navigation runtime (segment router, prefetch cache, history stack)
- Registers the RSC stream parser for navigation responses

### RSC Plugin Entry Configuration

The `@vitejs/plugin-rsc` plugin is configured with `entries` mapping each environment to timber's virtual entry modules:

```typescript
vitePluginRsc({
  entries: {
    rsc: 'virtual:timber-rsc-entry',
    ssr: 'virtual:timber-ssr-entry',
    client: 'virtual:timber-browser-entry',
  },
  customClientEntry: true,  // timber manages its own browser entry
  serverHandler: false,     // timber has its own dev server
})
```

The RSC plugin's built-in `buildApp` handles the 5-step multi-environment build sequence (analyze client references → analyze server references → build RSC → build client → build SSR). We do NOT set `customBuildApp` — the RSC plugin's orchestration is correct and handles bundle ordering, asset manifest generation, and environment imports manifest.

The `entries.client` option is critical for React Fast Refresh: the RSC plugin's `virtual:vite-rsc/entry-browser` module sets up the Fast Refresh preamble globals (`$RefreshReg$`, `$RefreshSig$`) and then dynamically imports the client entry specified by `entries.client`. The `customClientEntry: true` flag opts out of the RSC plugin's default "index" client entry convention.

---

## Build Pipeline

Production builds use `createBuilder()` + `builder.buildApp()` from Vite's JS API. Direct `build()` calls do NOT trigger the RSC plugin's multi-environment pipeline.

### 5-Step Sequence

```
1. RSC Build    — Server components, data functions, middleware, access gates
2. SSR Build    — Client component server-side rendering
3. Client Build — Browser bundles, CSS, assets
4. Manifest     — Build manifest with chunk hashes, CSS mappings, route→chunk associations
5. Adapter      — Platform-specific output transformation (Cloudflare worker entry, Node server, etc.)
```

Each step produces artifacts consumed by the next. The RSC build emits the route manifest and server component chunks. The SSR build references client component boundaries discovered during RSC build. The client build produces browser-loadable chunks. The manifest ties everything together for runtime chunk loading.

### Build Manifest

The build manifest maps routes to their required chunks (JS, CSS) for each environment. At runtime, the server uses the manifest to:

- Emit `<link rel="modulepreload">` for client chunks
- Emit `<link rel="stylesheet">` for CSS
- Generate 103 Early Hints at route-match time
- Resolve client component references in the RSC stream

---

## Dev Server

### HMR Wiring

Each Vite environment (RSC, SSR, Browser) has its own module graph and HMR channel:

- **Server component change** → RSC module invalidated → next request re-renders from scratch
- **Client component change** → Browser HMR update → React Fast Refresh preserves state
- **`middleware.ts` change** → RSC module invalidated → next request re-runs middleware
- **`access.ts` change** → RSC module invalidated → next request re-runs access gate
- **`timber.config.ts` change** → Full dev server restart (config is loaded once at startup)

### Route Tree Watching

`timber-routing` watches the `app/` directory for file changes. When a new `page.tsx`, `layout.tsx`, `middleware.ts`, or `access.ts` is created or deleted, the virtual route manifest is regenerated and dependent modules are invalidated.

### Startup Timing

The plugin context includes a `StartupTimer` that records per-phase durations using `performance.now()`. In dev mode, a timing summary is logged when the dev server finishes setup.

Instrumented phases:

| Phase | Hook | What it measures |
|-------|------|-----------------|
| `rsc-plugin-import` | `timber()` call | Dynamic `import('@vitejs/plugin-rsc')` |
| `config-load` | `buildStart` (root-sync) | Loading and merging `timber.config.ts` |
| `route-scan` | `buildStart` / `configureServer` | File system traversal of `app/` directory |
| `mdx-activate` | `buildStart` (mdx) | Dynamic import of `@mdx-js/rollup` |
| `content-activate` | `config` (content) | Dynamic import of `@content-collections/vite` |
| `dev-server-setup` | `configResolved` → `configureServer` | Total wall time from Vite config resolved to dev server ready |

**Optimization: single route scan in dev.** The route scanner (`scanRoutes`) used to run twice during dev startup — once in `buildStart` and again in `configureServer`. Since `configureServer` always runs after `buildStart` in dev mode, the `buildStart` scan is now skipped when `ctx.dev` is true.

In production builds, the timer is swapped to a no-op implementation with zero overhead.

---

## File Budgets

No single source file should exceed 500 lines. When a file approaches this limit, extract cohesive functionality into a new file:

| File | Budget | Scope |
|------|--------|-------|
| `index.ts` (plugin entry) | ~100 lines | Plugin composition, config loading |
| Each sub-plugin | ~200-400 lines | Single responsibility |
| `request-handler.ts` | ~300 lines | Route matching, pipeline orchestration |
| `element-tree.ts` | ~300 lines | React element tree construction (AccessGates, error boundaries, slots) |
| `metadata-resolver.ts` | ~200 lines | Metadata merge algorithm, title templates |

The 500-line budget is a guideline, not a hard rule. The goal is to prevent god objects — multi-thousand-line files that combine unrelated responsibilities. If a file is approaching the budget, it should be decomposed before it becomes unmanageable.
