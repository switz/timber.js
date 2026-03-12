# Next.js App Router → timber.js Migration Guide

This document captures every change made when migrating the
[Next.js App Router Playground](https://github.com/vercel/next-app-router-playground)
to timber.js. Each section provides the general rule, before/after code, and
the reason for the change. These rules are reusable for any Next.js App Router project.

---

## 1. Project Config Files

### Replace `next.config.ts` with `vite.config.ts`

**Before**
```ts
// next.config.ts
import type { NextConfig } from 'next';
const nextConfig: NextConfig = { /* ... */ };
export default nextConfig;
```

**After**
```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { timber } from '../../packages/timber-app/src/index';

export default defineConfig({
  plugins: [timber()],
  root: import.meta.dirname,
  server: { port: 3004, strictPort: true },
  resolve: {
    alias: {
      '#': resolve(import.meta.dirname), // path alias for project root
    },
  },
});
```

### Add `timber.config.ts` for MDX/page extensions

```ts
// timber.config.ts
export default {
  pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'],
};
```

### Update `tsconfig.json`

- Remove `"plugins": [{ "name": "next" }]`
- Change `"moduleResolution": "bundler"` (not `node16`)
- Remove `.next/**` from `include`

### Update `package.json`

- Remove: `next`, `@next/mdx`, `server-only`
- Add: `@timber/app: workspace:*`
- Keep: `react`, `react-dom`, codehike, mdx packages

---

## 2. `Metadata` Type Import

**Rule:** `Metadata` is exported from `@timber/app/server`, not `next`.

**Before**
```ts
import type { Metadata } from 'next';
```

**After**
```ts
import type { Metadata } from '@timber/app/server';
```

**Apply to:** Every layout or page that exports a `metadata` const.

---

## 3. `loading.tsx` → Explicit `<Suspense>` in Parent Layout

**Rule:** Next.js automatically wraps `{children}` in `<Suspense fallback={<Loading />}>` when a `loading.tsx` exists in the same directory. timber has no such convention — add the Suspense boundary explicitly in the parent layout.

**Before** (Next.js): `app/loading/layout.tsx` renders `{children}` and `app/loading/loading.tsx` auto-wraps it.

**After** (timber): The layout must explicitly import and use the loading component.

```ts
// app/loading/layout.tsx — BEFORE
export default function Layout({ children }) {
  return <div>{children}</div>;
}
```

```ts
// app/loading/layout.tsx — AFTER
import { Suspense } from 'react';
import Loading from './loading';

export default function Layout({ children }) {
  return (
    <div>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </div>
  );
}
```

**Note:** `loading.tsx` can remain in place — timber just ignores it. You still need to import it yourself.

---

## 4. `not-found.tsx` → `404.tsx`

**Rule:** timber's `deny(404)` renders the nearest `404.tsx` ancestor, not `not-found.tsx`. Rename all `not-found.tsx` files to `404.tsx`.

**File renames:**
- `app/not-found.tsx` → `app/404.tsx`
- `app/not-found/not-found.tsx` → `app/not-found/404.tsx`
- `app/not-found/[section]/not-found.tsx` → `app/not-found/[section]/404.tsx`

The `notFound()` shim in timber's `next/navigation` already calls `deny(404)`, so no code changes are needed — just rename the files.

---

## 5. `template.tsx` → Layout with `key` prop

**Rule:** timber has no `template.tsx` convention. `template.tsx` in Next.js remounts the subtree on every navigation by giving React a new key. In timber, achieve the same by passing `pathname` as a `key` to the layout or wrapper element.

**Before** (Next.js — `template.tsx` remounts on every navigation)
```tsx
// app/_hooks/template.tsx
export default function Template({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
```

**After** (timber — use `key={pathname}` in the parent layout instead)
```tsx
// app/_hooks/layout.tsx
'use client'; // or wrap a client component in layout if you need async server component
import { usePathname } from 'next/navigation';

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // key={pathname} causes React to remount the subtree on every navigation,
  // matching Next.js template.tsx semantics.
  return <div key={pathname}>{children}</div>;
}
```

If the template was purely structural (no remounting needed), replace it with a pass-through:
```tsx
export default function Template({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

---

## 6. `connection()` → Remove

**Rule:** `connection()` from `next/server` opts a page into dynamic rendering. timber is always dynamic — there is no static rendering to opt out of. Remove all calls.

**Before**
```ts
import { connection } from 'next/server';
export default async function Page() {
  await connection();
  // ...
}
```

**After**
```ts
export default async function Page() {
  // connection() removed — timber is always dynamic
  // ...
}
```

---

## 7. `generateStaticParams` → Remove

**Rule:** timber has no SSG. Remove `generateStaticParams` exports.

**Before**
```ts
export async function generateStaticParams() {
  return db.product.findMany().map((p) => ({ id: p.id }));
}
```

**After:** Delete the export entirely.

---

## 8. `'use cache'` + `cacheTag()` + `cacheLife()` → `timber.cache()`

### 8a. Simple `'use cache'` directive

**Before**
```ts
import { unstable_cacheTag as cacheTag } from 'next/cache';

async function getProducts() {
  'use cache';
  cacheTag('products');
  return db.product.findMany();
}
```

**After**
```ts
import { createCache } from '@timber/app/cache';

const getProducts = createCache(
  async () => db.product.findMany(),
  { tags: ['products'] }
);
```

### 8b. `'use cache: private'` (session-scoped)

**Rule:** In timber, `cookies()` cannot be called inside a cached function. Move the `cookies()` call outside, pass the session value as an argument, and use it to scope the cache key.

**Before**
```ts
async function getRecommendations(productId: string) {
  'use cache: private';
  const sessionCookie = await cookies();
  const sessionId = sessionCookie.get('sessionId')?.value ?? 'default';
  cacheTag(`recommendations-${productId}`);
  cacheLife({ revalidate: 60 });
  return db.recommendation.findMany({ where: { productId } });
}
```

**After**
```ts
import { createCache } from '@timber/app/cache';
import { cookies } from 'next/headers';

// cookies() called OUTSIDE the cached function (inside render)
const sessionCookie = await cookies();
const sessionId = sessionCookie.get('sessionId')?.value ?? 'default';

const getRecommendations = createCache(
  async (productId: string, sessionId: string) => {
    return db.recommendation.findMany({ where: { productId } });
  },
  {
    ttl: 60,
    tags: (productId: string) => [`recommendations-${productId}`],
  }
);

// Pass sessionId as argument so it's part of the cache key
const data = await getRecommendations(productId, sessionId);
```

### 8c. `'use cache: remote'`

Same as regular `timber.cache()` — timber's cache is always "remote" (KV-backed). Use `tags` and `ttl` options as needed.

---

## 9. `useLinkStatus` → `useNavigationPending`

**Rule:** timber has no per-link navigation status hook. Use `useNavigationPending()` from `@timber/app/client` as the closest equivalent. This is a **global** hook — it returns `true` when any navigation is pending, not just the specific link being clicked.

**Before**
```ts
import { useLinkStatus } from 'next/link';

function MyLink({ href, children }) {
  const { pending } = useLinkStatus();
  return <a href={href} className={pending ? 'loading' : ''}>{children}</a>;
}
```

**After**
```ts
import { useNavigationPending } from '@timber/app/client';

function MyLink({ href, children }) {
  const isPending = useNavigationPending();
  return <a href={href} className={isPending ? 'loading' : ''}>{children}</a>;
}
```

**Behavioral difference:** `useNavigationPending` reflects any active navigation, not just clicks on this specific link. All links will appear pending when any navigation is in progress.

**Gap filed:** [lb issue for per-link navigation status]

---

## 10. `Link.onNavigate` → `onClick` with `e.preventDefault()`

**Rule:** timber's `Link` component does not support the `onNavigate` prop. Use `onClick` with `e.preventDefault()` to intercept navigation and trigger your own logic before calling `router.push()`.

**Before**
```ts
import Link from 'next/link';

<Link
  href={href}
  onNavigate={(e) => {
    e.preventDefault();
    startTransition(() => {
      addTransitionType(type);
      router.push(href);
    });
  }}
>
```

**After**
```ts
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const router = useRouter();
const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
  event.preventDefault();
  startTransition(() => {
    addTransitionType(type);
    router.push(href);
  });
};

<Link href={href} onClick={handleClick}>
```

**Gap filed:** [lb issue for Link.onNavigate support]

---

## 11. `next/og` ImageResponse → SVG Stub

**Rule:** `next/og` uses the Vercel Edge Runtime (Satori + Resvg) which is not available on Cloudflare Workers. Replace with an SVG response stub, or use [Satori](https://github.com/vercel/satori) directly in a Worker-compatible build.

**Before**
```ts
import { ImageResponse } from 'next/og';
export async function GET(request: NextRequest) {
  return new ImageResponse(<div>...</div>, { width: 1200, height: 630 });
}
```

**After** (SVG stub — use Takumi RS for production OG images)
```ts
import type { RouteContext } from '@timber/app/server';

export async function GET(ctx: RouteContext): Promise<Response> {
  const title = ctx.searchParams.get('title') ?? 'My App';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="#1a1a2e"/>
    <text x="60" y="320" fill="white" font-size="64">${title}</text>
  </svg>`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
}
```

**Production alternative:** Use [Takumi RS](https://takumi.rs) for OG image generation on Cloudflare Workers.

---

## 12. `server-only` → Remove

**Rule:** The `server-only` npm package throws at import time if the module is accidentally bundled for the client. timber enforces RSC/server boundaries via its build system — the package is unnecessary.

**Before**
```ts
import 'server-only';
```

**After:** Delete the import.

---

## 13. API Route Signature

**Rule:** timber API routes use a single `ctx: RouteContext` argument, not `(request: Request, { params })`.

**Before**
```ts
import { type NextRequest } from 'next/server';
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
}
```

**After**
```ts
import type { RouteContext } from '@timber/app/server';
export async function GET(ctx: RouteContext): Promise<Response> {
  const id = ctx.params.id;
}
```

---

## 14. `'use cache'` on Components that Receive `params`

**Rule:** Do NOT put `'use cache'` at the file level (or inside the component body) on page/layout components that receive `params` as a `Promise`. The `'use cache'` transform serializes inputs to build cache keys — a Promise cannot be serialized, causing a runtime error.

**Before** (broken)
```ts
'use cache'; // file-level — wraps all exported functions

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ...
}
```

**After** (working)
```ts
// No 'use cache' directive — component always renders fresh

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ...
}
```

If you need caching, extract the data-fetching logic into a separate `timber.cache()`-wrapped function and call it from the component.

---

## 15. `404.tsx` (and other status files) Must Be `'use client'`

**Rule:** timber's error boundary (`TimberErrorBoundary`) is a React class component that passes `fallbackComponent` as a prop. React cannot pass server component functions as props across the RSC boundary. All status files (`404.tsx`, `error.tsx`, `403.tsx`, etc.) must be `'use client'` components.

**Before** (missing directive — causes "Functions cannot be passed directly to Client Components" error)
```ts
export default function NotFound() {
  return <div>Not found</div>;
}
```

**After**
```ts
'use client';

export default function NotFound() {
  return <div>Not found</div>;
}
```

**Static analysis gap filed:** TIM-166 (static analyzer should warn when status files are missing `'use client'`)

---

## Summary of Gaps Filed

| Gap | lb Issue | Description |
|-----|----------|-------------|
| `useLinkStatus` | TIM-168 | Per-link navigation status — timber only has global `useNavigationPending` |
| `Link.onNavigate` | TIM-167 | Prop not supported in timber's Link shim |
| `next/og` | — | Use [Takumi RS](https://takumi.rs) for OG images on CF Workers |
| `template.tsx` | — | A layout with `key={pathname}` achieves the same remounting effect |
| `next/font/google` named exports | TIM-87 | Shim only has `default` export, no `Geist`, `Geist_Mono` etc. |
| Status file `'use client'` lint | TIM-166 | Static analyzer should warn when status files missing `'use client'` |
| MDX config in `timber.config.ts` | TIM-86 | Plugin reads config at build time before `timber.config.ts` loads |
| `'use cache'` + Promise params | TIM-165 | Cannot serialize Promise inputs for cache key |
| Dev error overlay wiring | TIM-24 | Pipeline errors not routed to browser overlay |
