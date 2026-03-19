# Migrating from Next.js to timber.js

A step-by-step guide for migrating a Next.js App Router application to timber.js.

## Prerequisites

- **Node.js 20+**
- **React 19** (timber.js requires React 19 — if you're on React 18, upgrade first)
- **Vite 8** (installed as a dev dependency)
- **pnpm / npm / yarn** — any package manager works

```bash
npm install @timber-js/app
npm install -D vite
npm uninstall next
```

---

## 1. Configuration Migration

### `next.config.js` → `vite.config.ts` + `timber.config.ts`

Delete `next.config.js`. Create two new files:

**`vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { timber } from '@timber-js/app';

export default defineConfig({
  plugins: [timber()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
});
```

**`timber.config.ts`** (optional — only needed to configure output, adapters, etc.)

```ts
import { nitro } from '@timber-js/app/adapters/nitro';

export default {
  output: 'server' as const,
  adapter: nitro({ preset: 'node-server' }),
};
```

Key config mappings:
| `next.config.js` | timber.js equivalent |
|---|---|
| `output: 'standalone'` | `output: 'server'` in `timber.config.ts` + nitro adapter |
| `serverExternalPackages` | Vite `ssr.external` in `vite.config.ts` |
| `rewrites()` | `proxy.ts` (see [Middleware](#7-middleware--proxy)) |
| `logging.fetches` | Built-in dev request logging |
| `images` | Not needed (no image optimization runtime) |
| `experimental` | Generally not needed |

### `tsconfig.json` changes

```diff
{
  "compilerOptions": {
-   "plugins": [{ "name": "next" }],
+   // Remove the Next.js plugin — timber uses Vite's type generation
    "paths": {
      "@/*": ["src/*"]
    }
  },
- "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
+ "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

You can also delete `next-env.d.ts` if it exists.

### `package.json` script changes

```diff
{
  "scripts": {
-   "dev": "next dev",
-   "build": "next build",
-   "start": "next start",
+   "dev": "vite",
+   "build": "vite build",
+   "start": "node dist/server/index.mjs",
  }
}
```

---

## 2. Dependency Changes

### Remove

- `next`
- `next-redux-wrapper` — timber.js doesn't have a server-side Redux hydration step; create your store directly
- `nextjs-toploader` — Next.js-specific progress bar; use timber's built-in navigation events or a custom solution
- `@tanstack/react-query-next-experimental` — `ReactQueryStreamedHydration` is Next.js specific; TanStack Query works without it in timber (RSC data fetching just works)
- `next-zod-route` — Next.js-specific route handler wrapper; use native request parsing or a generic Zod validator

### Add

- `@timber-js/app`
- `vite` (dev dependency)

### Keep (no changes needed)

- React 19, React DOM
- `@tanstack/react-query`, `@tanstack/react-query-devtools`
- `nuqs` — shimmed via `nuqs/adapters/next/app` (timber provides the shim)
- Tailwind CSS, PostCSS
- Framer Motion
- Redux (`@reduxjs/toolkit`, `react-redux`)
- OpenTelemetry packages
- All other non-Next.js-specific dependencies

---

## 3. File Convention Changes

Most App Router file conventions carry over directly:

| Convention         | Next.js | timber.js           | Notes                                                               |
| ------------------ | ------- | ------------------- | ------------------------------------------------------------------- |
| `page.tsx`         | ✅      | ✅                  | Same                                                                |
| `layout.tsx`       | ✅      | ✅                  | Same                                                                |
| `route.ts`         | ✅      | ✅                  | Same (GET, POST, etc.)                                              |
| `error.tsx`        | ✅      | ✅                  | Same (`'use client'`, receives `error` + `reset`)                   |
| `global-error.tsx` | ✅      | ✅                  | Same                                                                |
| `not-found.tsx`    | ✅      | Rename to `404.tsx` | timber uses `404.tsx` for not-found pages                           |
| `loading.tsx`      | ✅      | ❌ Delete           | timber has no implicit loading states — use `<Suspense>` explicitly |
| `default.tsx`      | ✅      | ✅                  | Same (parallel route fallbacks)                                     |
| `template.tsx`     | ✅      | ❌                  | Not supported — use layout with key prop if needed                  |

### New conventions in timber.js

- `middleware.ts` — per-route middleware (runs after route matching, before rendering)
- `access.ts` — authorization gate (runs inside React tree)
- `proxy.ts` — global middleware (replaces Next.js `middleware.ts` at project root)
- `404.tsx`, `5xx.tsx`, `503.tsx` — status code pages
- `search-params.ts` — typed search params definition

### Dynamic routes

Same syntax: `[id]`, `[...slug]`, `[[...slug]]`, `(group)`, `@slot` all work identically.

---

## 4. Import Changes

timber.js provides shims for common Next.js imports, so many imports work without changes:

### Shimmed (works as-is)

```ts
import Link from 'next/link'; // → timber Link
import {
  useRouter,
  usePathname,
  useSearchParams,
  useParams,
  redirect,
  notFound,
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
} from 'next/navigation'; // → timber equivalents
import { headers, cookies } from 'next/headers'; // → timber ALS-backed implementations
import { Roboto } from 'next/font/google'; // → timber font pipeline
```

### Must change

```diff
- import type { Metadata } from 'next';
+ import type { Metadata } from '@timber-js/app/server';

- import { NextResponse } from 'next/server';
+ // Use standard Response instead
+ new Response('body', { status: 200 });

- import { ImageResponse } from 'next/og';
+ import { ImageResponse } from '@takumi-rs/image-response';
+ // Or any other satori-based image response library

- import Image from 'next/image';
+ // Shimmed as plain <img>, but consider replacing with native <img>
+ // The shim ignores optimization props (priority, quality, fill, placeholder)
```

### Not available

- `next/script` — use `<script>` tags directly
- `next/head` — use metadata exports (same as Next.js App Router)
- `next/dynamic` — use `React.lazy()` + `<Suspense>`

---

## 5. Data Fetching Changes

### No implicit fetch caching

In Next.js, `fetch()` has built-in caching and revalidation via `next: { revalidate }`. In timber.js, `fetch()` is just `fetch()` — no magic.

```diff
// Next.js — implicit caching
- const data = await fetch(url, { next: { revalidate: 300 } });

// timber.js — explicit caching
+ import { timber } from '@timber-js/app/cache';
+
+ const getCachedData = timber.cache(
+   async (url: string) => {
+     const res = await fetch(url);
+     return res.json();
+   },
+   { ttl: 300 }
+ );
+ const data = await getCachedData(url);
```

### `React.cache()` still works

Per-request deduplication via `React.cache()` works the same way. If your data fetching already uses `React.cache()` wrappers, it will continue to work.

### `unstable_cache()` → `timber.cache()`

```diff
- import { unstable_cache } from 'next/cache';
- const getCached = unstable_cache(fn, ['key'], { revalidate: 60 });
+ import { timber } from '@timber-js/app/cache';
+ const getCached = timber.cache(fn, { ttl: 60, key: () => 'key' });
```

### `revalidatePath()` / `revalidateTag()`

```diff
- import { revalidatePath, revalidateTag } from 'next/cache';
+ import { revalidatePath, revalidateTag } from '@timber-js/app/server';
```

---

## 6. Metadata Changes

### Static metadata

Works the same — export a `metadata` object from page or layout files:

```ts
export const metadata = {
  title: 'My Page',
  description: 'My description',
};
```

### `generateMetadata()` → `metadata()`

```diff
- export async function generateMetadata({ params }) {
+ export async function metadata({ params }) {
    return { title: `Post ${params.id}` };
  }
```

### `Metadata` type

```diff
- import type { Metadata } from 'next';
+ import type { Metadata } from '@timber-js/app/server';
```

The `Metadata` type is fully compatible — same fields for title, description, openGraph, twitter, robots, icons, etc.

---

## 7. Middleware & Proxy

### Global middleware: `middleware.ts` → `proxy.ts`

Next.js uses a root `middleware.ts` that runs on the edge for all requests. timber.js uses `proxy.ts` at the project root (or `src/proxy.ts`), which runs on the server before route matching.

```diff
- // middleware.ts (Next.js)
- import { NextResponse } from 'next/server';
- export function middleware(request) {
-   return NextResponse.redirect('/new-path');
- }
- export const config = { matcher: ['/old-path'] };

+ // proxy.ts (timber.js)
+ export default async (req: Request, next: () => Promise<Response>) => {
+   const url = new URL(req.url);
+   if (url.pathname === '/old-path') {
+     return Response.redirect(new URL('/new-path', req.url));
+   }
+   return next();
+ };
```

### Rewrites

Next.js rewrites from `next.config.js` should move to `proxy.ts`:

```ts
// proxy.ts
export default async (req: Request, next: () => Promise<Response>) => {
  const url = new URL(req.url);

  // Rewrite /privacy-policy to static file
  if (url.pathname === '/privacy-policy') {
    return new Response(
      await fetch(new URL('/privacy_policy.html', req.url)).then((r) => r.text()),
      {
        headers: { 'content-type': 'text/html' },
      }
    );
  }

  // External redirect
  if (url.pathname === '/discord') {
    return Response.redirect('https://discordapp.com/invite/73fdDSS');
  }

  return next();
};
```

### Per-route middleware (new in timber.js)

timber.js supports per-route `middleware.ts` files that run after route matching but before rendering:

```ts
// src/app/dashboard/middleware.ts
import type { MiddlewareContext } from '@timber-js/app/server';

export default async (ctx: MiddlewareContext) => {
  // Set response headers, check auth, etc.
  ctx.headers.set('x-custom', 'value');
};
```

---

## 8. Instrumentation

timber.js supports the same `instrumentation.ts` convention:

```diff
// src/instrumentation.ts
  export async function register() {
-   if (process.env.NEXT_RUNTIME === 'nodejs') {
+   // timber.js always runs in Node.js (no edge runtime split)
    const { initTracing } = await import('./lib/tracing');
    initTracing();
-   }
  }
```

timber.js also supports additional exports:

```ts
export async function onRequestError(error, request, context) {
  // Called on unhandled request errors
}

export const logger = {
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};
```

---

## 9. Redux Migration

If using `next-redux-wrapper`, you can simplify. The wrapper exists to hydrate server-side Redux state into the client — timber.js doesn't have this pattern.

```diff
// src/redux/index.ts
- import { createWrapper } from 'next-redux-wrapper';
  import { configureStore } from '@reduxjs/toolkit';
  import reducers from './modules';

- export const initStore = () => configureStore({ reducer: reducers });
- export const store = initStore();
- export const wrapper = createWrapper(initStore);
+ export const store = configureStore({ reducer: reducers });
+ export type RootState = ReturnType<typeof store.getState>;
+ export type AppDispatch = typeof store.dispatch;
```

Remove `HYDRATE` handling from reducers — it's no longer needed:

```diff
// reducers
- import { HYDRATE } from 'next-redux-wrapper';

  export default function myReducer(state = defaultState, action) {
    switch (action.type) {
-     case HYDRATE:
-       return { ...state, ...action.payload?.mySlice };
      case UPDATE:
        return { ...state, ...action.data };
      default:
        return state;
    }
  }
```

---

## 10. Edge Runtime

timber.js runs entirely on Node.js — there is no edge runtime split. Routes marked with `export const runtime = 'edge'` should be updated:

```diff
- export const runtime = 'edge';
+ // Remove — timber.js uses Node.js for all routes
```

If you were using edge-only APIs (like `next/og` which uses `@vercel/og`), switch to Node.js-compatible alternatives (like `@takumi-rs/image-response` or `satori` directly).

---

## 11. Known Compatibility Issues

### Libraries that need attention

| Library                                   | Status        | Notes                                             |
| ----------------------------------------- | ------------- | ------------------------------------------------- |
| `nuqs`                                    | ✅ Works      | Shimmed via `nuqs/adapters/next/app`              |
| `@tanstack/react-query`                   | ✅ Works      | Core library is framework-agnostic                |
| `@tanstack/react-query-next-experimental` | ❌ Remove     | Next.js-specific; not needed with timber          |
| `next-redux-wrapper`                      | ❌ Remove     | Replace with direct store creation                |
| `nextjs-toploader`                        | ❌ Remove     | Next.js-specific; use custom navigation indicator |
| `next-zod-route`                          | ❌ Remove     | Next.js-specific; parse request params directly   |
| `next-intl`                               | ✅ Works      | Shimmed by timber                                 |
| `next-auth` / `auth.js`                   | ⚠️ Needs work | May need adaptation                               |
| Framer Motion                             | ✅ Works      | Framework-agnostic                                |
| Tailwind CSS                              | ✅ Works      | Framework-agnostic                                |

### `NextResponse` → `Response`

Replace all uses of `NextResponse` with standard `Response`. The Web API `Response` class covers all common cases:

```ts
new Response('body');
new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
Response.redirect(url);
Response.json(data); // Node 20+
```

---

## Migration Checklist

### Phase 1: Setup

- [ ] Install `@timber-js/app` and `vite`
- [ ] Remove `next` and Next.js-specific packages
- [ ] Create `vite.config.ts`
- [ ] Create `timber.config.ts` (if needed)
- [ ] Update `tsconfig.json`
- [ ] Update `package.json` scripts
- [ ] Delete `next.config.js` and `next-env.d.ts`

### Phase 2: File Conventions

- [ ] Rename `not-found.tsx` → `404.tsx`
- [ ] Delete any `loading.tsx` files (add `<Suspense>` where needed)
- [ ] Move root `middleware.ts` to `proxy.ts`
- [ ] Move `next.config.js` rewrites to `proxy.ts`

### Phase 3: Imports

- [ ] Update `Metadata` type imports to `@timber-js/app/server`
- [ ] Replace `NextResponse` with `Response`
- [ ] Replace `next/og` with a Node.js image response library
- [ ] Remove `export const runtime = 'edge'` declarations
- [ ] Remove `next: { revalidate }` from fetch calls (or migrate to `timber.cache()`)
- [ ] Shimmed imports (`next/link`, `next/navigation`, `next/headers`, `next/font/google`) work as-is

### Phase 4: Data & State

- [ ] Remove `next-redux-wrapper` and `HYDRATE` handling
- [ ] Remove `ReactQueryStreamedHydration` wrapper
- [ ] Migrate `unstable_cache()` to `timber.cache()` if applicable
- [ ] Update `generateMetadata()` to `metadata()` if applicable

### Phase 5: Verify

- [ ] `pnpm install` succeeds
- [ ] `pnpm dev` (vite) starts without errors
- [ ] Pages render correctly
- [ ] Navigation works (client-side transitions)
- [ ] API routes work
- [ ] Metadata renders in `<head>`
- [ ] Error pages work
