# Metadata

## Declaration API

Two forms, both exports from `page.tsx` or `layout.tsx`:

```tsx
// Static — known at module load time
import type { Metadata } from '@timber/app/server'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your project dashboard',
}

// Dynamic — async, receives route context
export async function generateMetadata({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}): Promise<Metadata> {
  const { id } = await params
  const product = await getProduct(id)
  return {
    title: product.name,
    description: product.summary,
    openGraph: { images: [product.imageUrl] },
  }
}
```

A module exports one or the other — not both. Build error if both are present.

### `generateMetadata` Receives Promises

`params` and `searchParams` are passed as Promises, matching React 19 conventions. The framework wraps the values in a thenable-object pattern (Promise that also has sync property access in dev mode for migration convenience), but the declared type is `Promise<T>`.

`generateMetadata` runs during the render pass. `React.cache` is active. A `getProduct()` call inside `generateMetadata` and the same call in the page component share one `React.cache` scope — no duplicate fetches.

---

## The `Metadata` Type

```typescript
import type { Metadata } from '@timber/app/server'

interface Metadata {
  // --- Core ---
  title?: string | { default?: string; template?: string; absolute?: string }
  description?: string

  // --- Authorship ---
  generator?: string
  applicationName?: string
  authors?: Array<{ name?: string; url?: string }> | { name?: string; url?: string }
  creator?: string
  publisher?: string

  // --- Crawling ---
  robots?: string | {
    index?: boolean
    follow?: boolean
    googleBot?: string | { index?: boolean; follow?: boolean; [key: string]: unknown }
    [key: string]: unknown
  }
  referrer?: string
  keywords?: string | string[]
  category?: string

  // --- Open Graph ---
  openGraph?: {
    title?: string
    description?: string
    url?: string
    siteName?: string
    images?: string | Array<{ url: string; width?: number; height?: number; alt?: string }>
    videos?: Array<{ url: string; width?: number; height?: number }>
    audio?: Array<{ url: string }>
    locale?: string
    type?: string
    publishedTime?: string
    modifiedTime?: string
    authors?: string[]
  }

  // --- Twitter ---
  twitter?: {
    card?: string
    site?: string
    siteId?: string
    title?: string
    description?: string
    images?: string | string[] | Array<{ url: string; alt?: string; width?: number; height?: number }>
    creator?: string
    creatorId?: string
  }

  // --- Icons ---
  icons?: {
    icon?: string | Array<{ url: string; sizes?: string; type?: string; media?: string }>
    shortcut?: string | string[]
    apple?: string | Array<{ url: string; sizes?: string; type?: string }>
    other?: Array<{ rel: string; url: string; sizes?: string; type?: string }>
  }

  // --- Links ---
  manifest?: string
  alternates?: {
    canonical?: string
    languages?: Record<string, string>
    media?: Record<string, string>
    types?: Record<string, string>
  }

  // --- Verification ---
  verification?: {
    google?: string
    yahoo?: string
    yandex?: string
    other?: Record<string, string | string[]>
  }

  // --- URL resolution ---
  metadataBase?: URL | null

  // --- Apple ---
  appleWebApp?: {
    capable?: boolean
    title?: string
    statusBarStyle?: string
    startupImage?: string | Array<{ url: string; media?: string }>
  }

  // --- Misc ---
  formatDetection?: { email?: boolean; address?: boolean; telephone?: boolean }
  other?: Record<string, string | string[]>
}
```

### No Separate Viewport Type

Next.js separates `Viewport` from `Metadata` (with `export const viewport` and `generateViewport()`). timber.js does not. The framework always emits:

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
```

These are framework-injected defaults, not part of the `Metadata` type. They cannot be overridden or removed through metadata exports. If a page needs a custom viewport (rare — kiosk apps, embedded webviews), use a `<meta>` tag in the root layout's `<head>` directly.

Viewport rarely changes per-page. A separate export adds API surface for minimal benefit.

---

## Resolution: Part of the Render Pass

Metadata resolves during the `renderToReadableStream` call — inside the React render pass, not before it. The framework walks the segment chain (layouts + page), resolves each module's metadata (static export or `generateMetadata()` call), merges the results, and renders `<title>`, `<meta>`, `<link>` elements into the `<head>`.

Because resolution happens inside the render pass:

- **`React.cache` is active.** A `getProduct()` call inside `generateMetadata` and the same call in the page component share one `React.cache` scope — no duplicate fetches.
- **Metadata is outside `<Suspense>`.** It resolves as part of the shell, before `onShellReady`.
- **Metadata is complete before flush.** No race condition, no partial metadata, no client-side injection.

### The Flush-Point Advantage

Metadata follows the render-pass resolution pattern (see [Rendering Pipeline — Render-Pass Resolution](02-rendering-pipeline.md#render-pass-resolution)). It resolves inside `renderToReadableStream`, outside `<Suspense>`, sharing `React.cache` with the page. Because timber.js holds flush until `onShellReady`, metadata is **always complete before the first byte is sent**.

```
timber.js metadata timeline:

  t=0ms   → Request arrives
  t=2ms   → middleware.ts runs (can warm caches used by generateMetadata)
  t=5ms   → Render begins
  t=8ms   → All generateMetadata() calls resolve (React.cache shared with page)
  t=10ms  → <head> tags rendered into shell
  t=15ms  → Page component renders
  t=20ms  → onShellReady fires
  t=20ms  → Status code committed, full <head> flushed with correct metadata
```

### middleware.ts Can Warm Metadata Caches

`generateMetadata` often fetches the same data the page needs. Because `middleware.ts` runs before rendering and fires prefetches via `timber.cache`, the data is often already warm:

```typescript
// app/products/[id]/middleware.ts
export default async function middleware(ctx: MiddlewareContext) {
  void getProduct(ctx.params.id)  // warms cache for both generateMetadata and page
}
```

---

## Composition: Page Wins, Layouts Opt-In

The merge algorithm processes metadata from root layout to page, in segment order. The page is always last and always authoritative.

### Rules

1. **Shallow merge.** For each top-level key in `Metadata`, later entries override earlier ones. `openGraph` from the page replaces `openGraph` from the layout entirely — no deep merge of nested objects.

2. **Page is authoritative.** The page's metadata is the final word. Layouts provide defaults that the page can override.

3. **Title templates.** Layouts can define `title.template`. The page provides `title` as a string. The framework applies the nearest ancestor's template to the page's title.

4. **`title.absolute` skips templates.** A page that needs a specific title without any template wrapping uses `title: { absolute: 'Exact Title' }`.

5. **`title.default` is the layout's own title.** When a layout defines `title: { default: 'Dashboard', template: '%s | Dashboard' }`, the `default` is used when no child provides a title. The `template` is applied to child titles.

6. **Parallel slots do not contribute metadata.** Slots are secondary content regions — only the segment chain (layouts + page) produces metadata. A slot's `page.tsx` cannot export `metadata` or `generateMetadata`. Build error if it does.

### Title Template Example

```
app/
  layout.tsx        → metadata: { title: { default: 'My App', template: '%s | My App' } }
  dashboard/
    layout.tsx      → metadata: { title: { template: '%s — Dashboard | My App' } }
    page.tsx        → metadata: { title: 'Overview' }
    settings/
      page.tsx      → metadata: { title: { absolute: 'Settings' } }
```

| Route | Resolved `<title>` |
|---|---|
| `/dashboard` | `Overview — Dashboard \| My App` |
| `/dashboard/settings` | `Settings` |
| `/` (root page with no title) | `My App` |

The nearest ancestor template wins. `/dashboard`'s page title `'Overview'` is formatted with the dashboard layout's template. `/dashboard/settings` uses `absolute` to skip all templates.

### Merge Algorithm

```
Input: [rootLayoutMeta, ...nestedLayoutMetas, pageMeta]

1. merged = {}
2. titleTemplate = undefined
3. For each entry (root → page):
   a. If entry has title.template → titleTemplate = entry.title.template
   b. Shallow-merge all keys except title into merged (later wins)
   c. merged.title = entry.title (raw, unresolved)
4. Resolve final title:
   - string → apply titleTemplate if exists: template.replace('%s', title)
   - { absolute: '...' } → use as-is, skip template
   - { default: '...' } → use default (layout's own fallback when no child provides title)
   - undefined → use most recent default from any ancestor, or no title
```

---

## Default Metadata

The framework always emits, regardless of user metadata:

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
```

These are not part of the `Metadata` type and cannot be removed. The framework does NOT inject a default `robots` tag — only user-specified robots metadata is rendered.

---

## Metadata and Suspense

Metadata lives outside `<Suspense>` by definition. `<MetadataResolver>` is placed in the element tree above all Suspense boundaries and resolves as part of the shell.

A slow `generateMetadata()` blocks `onShellReady` — just like a slow page component outside Suspense. This is correct: metadata must be complete before bytes are sent. If `generateMetadata` is slow because it fetches data, warm the cache in `middleware.ts`.

There is no mechanism for a component inside a Suspense boundary to contribute metadata. Metadata is a page/layout module export, not a component concern.

---

## Error State Metadata

When an error boundary catches a render-phase error (`deny()`, unhandled throw), the error page renders within the parent layout chain. Metadata behavior:

1. **Parent layout metadata applies.** Layouts above the error boundary already contributed their metadata to `<MetadataResolver>`. That metadata renders normally.

2. **Page metadata is lost.** The page threw — its `generateMetadata` may not have completed. The framework does not attempt partial page metadata.

3. **Auto `noindex`.** The framework injects `<meta name="robots" content="noindex">` for all error states. Error pages should not be indexed.

```
Route: /products/[id] where product doesn't exist
Layout metadata: { title: { default: 'My Store', template: '%s | My Store' } }
Page calls deny(404) → HTTP 404

Resolved metadata:
  - Layout metadata chain applies (template, openGraph defaults, etc.)
  - Page title absent → layout's title.default used → <title>My Store</title>
  - <meta name="robots" content="noindex"> injected automatically
  - Any user-specified robots metadata is overridden by noindex
```

The same applies to status-code files (`4xx.tsx`, `5xx.tsx`) and `error.tsx`. Parent layout metadata + `noindex`.

---

## `metadataBase` — URL Resolution

`metadataBase` sets the base URL for resolving relative URLs in metadata fields. Typically set once in the root layout:

```tsx
// app/layout.tsx
export const metadata: Metadata = {
  metadataBase: new URL('https://myapp.com'),
  title: { default: 'My App', template: '%s | My App' },
}
```

Relative URLs in any metadata field are resolved against `metadataBase`:

```tsx
// app/products/[id]/page.tsx
export async function generateMetadata({ params }) {
  const { id } = await params
  const product = await getProduct(id)
  return {
    openGraph: {
      images: ['/images/products/' + product.image],
      // → https://myapp.com/images/products/shoe.jpg
    },
    alternates: {
      canonical: '/products/' + id,
      // → https://myapp.com/products/123
    },
  }
}
```

Absolute URLs (starting with `http://`, `https://`, or `//`) are not modified. `metadataBase` participates in the merge chain — it can be set in any layout and is inherited by children.

---

## Metadata Routes

File-based metadata routes generate well-known URLs for crawlers and browsers. These are separate HTTP endpoints that return non-HTML responses — they are NOT part of the `Metadata` type.

### File Conventions

| File | URL | Content-Type | Nestable | Dynamic |
|---|---|---|---|---|
| `sitemap.xml` / `sitemap.ts` | `/sitemap.xml` | `application/xml` | Yes | Yes |
| `robots.txt` / `robots.ts` | `/robots.txt` | `text/plain` | No | Yes |
| `manifest.json` / `manifest.ts` | `/manifest.webmanifest` | `application/manifest+json` | No | Yes |
| `favicon.ico` | `/favicon.ico` | `image/x-icon` | No | No |
| `icon.png` / `icon.tsx` | `/icon` | `image/*` | Yes | Yes |
| `opengraph-image.png` / `opengraph-image.tsx` | `/opengraph-image` | `image/*` | Yes | Yes |
| `twitter-image.png` / `twitter-image.tsx` | `/twitter-image` | `image/*` | Yes | Yes |
| `apple-icon.png` / `apple-icon.tsx` | `/apple-icon` | `image/*` | Yes | Yes |

**Nestable** means the file can appear in any route segment, not just the app root. A `sitemap.ts` in `app/blog/` serves at `/blog/sitemap.xml`. Non-nestable files are root-only.

**Dynamic** files (`.ts`, `.tsx`) export a default function that returns the content:

```typescript
// app/sitemap.ts
import type { MetadataRoute } from '@timber/app/server'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await db.products.findAll()
  return products.map(p => ({
    url: `https://myapp.com/products/${p.id}`,
    lastModified: p.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))
}
```

```tsx
// app/opengraph-image.tsx
import { ImageResponse } from '@takumi-rs/image-response'

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await getProduct(id)
  return new ImageResponse(
    <div style={{ fontSize: 48, background: 'white', width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {product.name}
    </div>,
    { width: 1200, height: 630 }
  )
}
```

**OG image generation uses `@takumi-rs/image-response`**, not `@vercel/og` or `next/og`. `@takumi-rs/image-response` provides the same `ImageResponse` API (satori JSX → image) but is built in Rust and runs natively on Cloudflare Workers without the WASM patching hacks that `@vercel/og` requires. `next/og` imports are not shimmed — use `@takumi-rs/image-response` directly.

**Static files** (`.xml`, `.txt`, `.json`, `.png`, `.jpg`, `.ico`) are served as-is with the appropriate content type. When both a static and dynamic variant exist at the same path, the dynamic variant takes precedence.

### Pipeline Integration

Metadata routes run through `proxy.ts` like all other routes. They do **not** run through `middleware.ts` or `access.ts` — these are public endpoints by nature (crawlers must access them without auth).

### Auto-Linking

When the framework discovers metadata route files in a segment, it automatically adds the corresponding tags to that segment's metadata:

- `icon.png` → `<link rel="icon" href="/icon">` in `<head>`
- `apple-icon.png` → `<link rel="apple-touch-icon" href="/apple-icon">`
- `manifest.json` → `<link rel="manifest" href="/manifest.webmanifest">`

Nestable image routes in a segment are linked only for pages within that segment.

---

## Metadata in Static Output Modes

### `static` Mode

- `export const metadata` resolves at build time
- `generateMetadata()` runs at build time. It cannot read `cookies()` or `headers()` (build error). It can read `params` (from the static params set) and `searchParams` (empty at build time)
- Metadata routes execute at build time and emit static files

### `static` + `noJS` Mode

Same as `static` for metadata resolution. Metadata tags are rendered into the static HTML `<head>`. No client-side hydration needed — the output is complete HTML with all metadata in place.

---

## What Metadata Does NOT Do

- **HTTP headers.** Metadata produces `<head>` tags only. `Cache-Control`, `Content-Security-Policy`, `X-Frame-Options`, etc. belong in `middleware.ts` or `proxy.ts`.
- **JSON-LD / structured data.** Use a `<script type="application/ld+json">` tag in your page component. This is regular React rendering, not a metadata concern.
- **Per-component metadata.** Metadata is a route-level concept. Components inside the page tree cannot contribute to `<head>` through the metadata system.
- **`"use cache"` interaction.** Metadata is a page/layout export. Cached components do not affect `<head>` tags.
