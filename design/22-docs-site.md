# Docs & Marketing Site

## Purpose

timber.js needs a public-facing documentation and marketing site. The site is a timber.js app itself — it dogfoods the framework, demonstrates real patterns, and serves as a living reference for how to build with timber.js.

The site uses `output: 'server'` so it can showcase forms, server actions, middleware, and other server-side features that a static export would strip away. It runs on Cloudflare Workers alongside the framework it documents.

---

## Package

The site lives at `packages/docs-site` as a workspace package named `@timber/docs-site`. It is not published to npm — it is a deployable app, not a library.

```
packages/docs-site/
  package.json
  vite.config.ts
  timber.config.ts
  tsconfig.json
  content-collections.ts
  mdx-components.tsx

  app/
    globals.css
    layout.tsx                  # Root chrome: nav, footer
    page.tsx                    # Marketing landing page
    components/
      ai-docs-banner.tsx        # Warning banner for AI-generated content
    docs/
      layout.tsx                # Sidebar nav
      page.tsx                  # Redirects to first doc
      [slug]/
        page.tsx                # Individual doc page
    blog/
      page.tsx                  # Blog index
      [slug]/
        page.tsx                # Individual blog post
    examples/
      layout.tsx                # Examples chrome
      contact/
        page.tsx                # Contact form — demonstrates server actions
        actions.ts              # Form action with validation
      newsletter/
        page.tsx                # Newsletter signup — demonstrates progressive enhancement
        actions.ts

  content/
    docs/
      getting-started.mdx
      configuration.mdx
      routing.mdx
    blog/
      hello-world.mdx

  public/
    favicon.ico
```

---

## Configuration

### `timber.config.ts`

```ts
export default {
  output: 'server',
  pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'],
  mdx: {
    remarkPlugins: [],    // add remark-gfm, etc. as needed
    rehypePlugins: [],    // add rehype-shiki for syntax highlighting
  },
}
```

Server mode is intentional. The site demonstrates:

- **Server actions** — contact form, newsletter signup, feedback widgets
- **Middleware** — cache headers, redirects from old doc URLs
- **`timber.cache`** — caching rendered doc pages at the edge
- **Progressive enhancement** — forms that work without JavaScript

A static export would lose all of these. The docs site should be the canonical proof that timber.js server mode is fast enough for content sites.

### `vite.config.ts`

Follows the existing example pattern:

```ts
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { timber } from '../../packages/timber-app/src/index'
import tailwindcss from '@tailwindcss/vite'

const root = resolve(import.meta.dirname, '../..')

export default defineConfig({
  plugins: [timber(), tailwindcss()],
  root: import.meta.dirname,
  server: {
    port: 3003,
    strictPort: true,
  },
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@timber/app/cache': resolve(root, 'packages/timber-app/src/cache/index.ts'),
      '@timber/app/server': resolve(root, 'packages/timber-app/src/server/index.ts'),
      '@timber/app/client': resolve(root, 'packages/timber-app/src/client/index.ts'),
      '@timber/app/content': resolve(root, 'packages/timber-app/src/content/index.ts'),
      '@timber/app/routing': resolve(root, 'packages/timber-app/src/routing/index.ts'),
      '@timber/app/search-params': resolve(root, 'packages/timber-app/src/search-params/index.ts'),
      '@timber/app': resolve(root, 'packages/timber-app/src/index.ts'),
    },
  },
})
```

### Styling

Tailwind v4 via `@tailwindcss/vite`. Zero-config — no `tailwind.config.js` or `postcss.config.js`. Same setup as `examples/tailwind`.

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  --color-timber: #2d5016;
  --color-timber-light: #4a7c28;
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
```

---

## Content Collections

Two collections defined in `content-collections.ts`:

### Docs Collection

```ts
const docs = defineCollection({
  name: 'docs',
  directory: 'content/docs',
  include: '**/*.{mdx,md}',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number(),              // sidebar sort order
    section: z.string().optional(), // grouping: "Getting Started", "API", etc.
  }),
  transform: async (document, context) => {
    const mdx = await compileMDX(context, document)
    return { ...document, mdx }
  },
})
```

### Blog Collection

```ts
const blog = defineCollection({
  name: 'blog',
  directory: 'content/blog',
  include: '**/*.{mdx,md}',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    author: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
  transform: async (document, context) => {
    const mdx = await compileMDX(context, document)
    return { ...document, mdx }
  },
})
```

---

## Routes

### `/` — Landing Page

Marketing page. Hero section with tagline and CTA. Feature grid highlighting timber.js design values:

| Feature | Copy |
|---------|------|
| Correct HTTP | Real status codes, real headers. No more 200-for-everything. |
| No loading spinners | Primary content renders before the shell flushes. Pages arrive complete. |
| Vite-native | Built on Vite 7. ESM-first. Sub-second HMR. |
| Cloudflare Workers | Edge-first deployment. Your code runs close to your users. |
| Server actions | Forms that work without JavaScript. Progressive enhancement by default. |
| React Server Components | Server-rendered by default. Client JS only where you ask for it. |

No animations. No JavaScript for the landing page beyond hydration.

### `/docs` — Documentation

Sidebar layout generated from the docs content collection, sorted by `order`, grouped by `section`.

```tsx
// app/docs/layout.tsx
import { allDocs } from 'content-collections'

export default function DocsLayout({ children }) {
  const sections = groupBy(allDocs.sort((a, b) => a.order - b.order), 'section')

  return (
    <div className="flex">
      <nav className="w-64 shrink-0">
        {Object.entries(sections).map(([section, docs]) => (
          <div key={section}>
            {section && <h3>{section}</h3>}
            <ul>
              {docs.map((doc) => (
                <li key={doc._meta.path}>
                  <Link href={`/docs/${doc._meta.path}`}>{doc.title}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
```

`/docs` itself redirects to the first doc (lowest `order`). No index page.

Each doc page renders the MDX content with the AI-generated content banner.

### `/blog` — Blog

Blog index lists all published posts sorted by date. Each post page renders the full MDX content with a header (title, date, author, tags).

`generateStaticParams()` on both `[slug]` routes ensures all valid slugs are known at build time for prerendering when that feature lands.

### `/examples/contact` — Contact Form Demo

A working contact form that demonstrates:

- `createActionClient` with Zod validation
- Progressive enhancement — works without JavaScript
- `ActionError` handling and form error display
- `revalidatePath` after successful submission

```tsx
// app/examples/contact/page.tsx
'use client'
import { useActionState } from 'react'
import { submitContact } from './actions'

export default function ContactPage() {
  const [state, action, pending] = useActionState(submitContact, null)

  return (
    <form action={action}>
      <input name="email" type="email" required />
      <textarea name="message" required />
      <button type="submit" disabled={pending}>
        {pending ? 'Sending...' : 'Send'}
      </button>
      {state?.error && <p className="text-red-600">{state.error}</p>}
      {state?.success && <p className="text-green-600">Message sent!</p>}
    </form>
  )
}
```

```ts
// app/examples/contact/actions.ts
'use server'
import { action } from '@/lib/action'
import { z } from 'zod'

export const submitContact = action
  .schema(z.object({
    email: z.string().email(),
    message: z.string().min(10).max(1000),
  }))
  .action(async ({ input }) => {
    // In production: send email, store in DB, etc.
    console.log('Contact form submission:', input)
    return { success: true }
  })
```

### `/examples/newsletter` — Newsletter Signup Demo

Minimal form demonstrating progressive enhancement — a single email input that works as a plain `<form>` without JavaScript and enhances with `useActionState` when JS loads.

---

## AI-Generated Content Banner

Every doc page displays a banner:

```tsx
// app/components/ai-docs-banner.tsx
export function AiDocsBanner() {
  return (
    <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 mb-6">
      <p className="text-amber-800 text-sm font-semibold">AI-Generated Placeholder</p>
      <p className="text-amber-700 text-sm mt-1">
        This documentation was generated by AI as scaffolding and may contain inaccuracies.
        Hand-written documentation is coming soon.
      </p>
    </div>
  )
}
```

This component is imported in `app/docs/[slug]/page.tsx` and rendered above the MDX content. Blog posts do not get this banner — blog content is editorial.

---

## Root Layout

```tsx
// app/layout.tsx
import { Link } from '@timber/app/client'
import './globals.css'

export const metadata = {
  title: {
    template: '%s | timber.js',
    default: 'timber.js — Vite-native React framework for Cloudflare Workers',
  },
  description: 'A web framework built on Vite and React Server Components. Correct HTTP semantics, real status codes, pages that work without JavaScript.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <header className="border-b">
          <nav className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link href="/" className="font-bold text-lg">timber.js</Link>
            <div className="flex gap-6">
              <Link href="/docs">Docs</Link>
              <Link href="/blog">Blog</Link>
              <a href="https://github.com/AshMartian/timber-js" target="_blank" rel="noopener">GitHub</a>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="border-t mt-16 py-8">
          <div className="max-w-6xl mx-auto px-4 text-sm text-gray-500">
            timber.js
          </div>
        </footer>
      </body>
    </html>
  )
}
```

---

## Dependencies

```json
{
  "dependencies": {
    "@timber/app": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@content-collections/core": "...",
    "@content-collections/mdx": "...",
    "@content-collections/vite": "...",
    "@mdx-js/rollup": "...",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "vite": "^7.0.0",
    "zod": "..."
  }
}
```

Version numbers follow the existing `examples/blog` and `examples/tailwind` packages.

---

## What This Doc Does Not Cover

- **Visual design.** Color palette, typography scale, and page layouts will be iterated on after scaffolding is in place.
- **Search.** Full-text doc search is a future feature. Not needed for scaffolding.
- **Versioned docs.** See [Doc Versioning](#doc-versioning) below.
- **Deployment.** Cloudflare Workers deployment config (wrangler.toml, etc.) will be added when the site is ready to ship.
- **Analytics.** No tracking in scaffolding. Add later if needed.

---

## Doc Versioning

### URL Structure

Docs are versioned by URL prefix. The canonical URL for a doc page includes the version:

```
/docs/v1/getting-started
/docs/v1/routing
/docs/v2/getting-started
/docs/v2/routing
```

`/docs/latest/getting-started` is an alias that redirects (302) to the current version. `/docs/getting-started` (no version prefix) also redirects to latest. This keeps one canonical URL per doc page — no duplicate content, clean cache behavior.

### Route Structure

```
app/
  docs/
    layout.tsx                        # Outer docs chrome (version selector)
    page.tsx                          # Redirects to /docs/latest
    [slug]/
      middleware.ts                   # Redirects /docs/foo → /docs/latest/foo
    [version]/
      layout.tsx                      # Sidebar nav (filtered to this version)
      [slug]/
        page.tsx                      # Individual doc page
```

### Middleware for Redirects

```ts
// app/docs/[slug]/middleware.ts
// Catches /docs/getting-started (no version) and redirects to latest
import { redirect } from '@timber/app/server'
import { LATEST_VERSION } from '@/lib/docs'

export default async function middleware(ctx) {
  redirect(`/docs/${LATEST_VERSION}/${ctx.params.slug}`)
}
```

The `[slug]` route exists only for the redirect — it has no `page.tsx`. The `[version]/[slug]` route handles actual rendering.

```ts
// app/docs/[version]/[slug]/page.tsx
import { allDocs } from 'content-collections'
import { deny, redirect } from '@timber/app/server'
import { LATEST_VERSION } from '@/lib/docs'

export default async function DocPage({ params }) {
  const { version, slug } = await params

  // Redirect /docs/latest/foo → /docs/v1/foo
  if (version === 'latest') redirect(`/docs/${LATEST_VERSION}/${slug}`)

  const doc = allDocs.find(
    (d) => d.version === version && d._meta.path === slug
  )
  if (!doc) deny(404)

  // render doc...
}
```

### Content Organization

Each version is a subdirectory in `content/docs/`:

```
content/
  docs/
    v1/
      getting-started.mdx
      configuration.mdx
      routing.mdx
    v2/
      getting-started.mdx
      routing.mdx
```

The `version` field is derived from the directory structure in the content collection schema:

```ts
const docs = defineCollection({
  name: 'docs',
  directory: 'content/docs',
  include: '**/*.{mdx,md}',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number(),
    section: z.string().optional(),
  }),
  transform: async (document, context) => {
    const mdx = await compileMDX(context, document)
    // _meta.directory is "v1", "v2", etc.
    return { ...document, mdx, version: document._meta.directory }
  },
})
```

### Version Configuration

A single constant defines the current version:

```ts
// lib/docs.ts
export const LATEST_VERSION = 'v1'
export const ALL_VERSIONS = ['v1'] as const
```

When v2 ships, add it to `ALL_VERSIONS` and update `LATEST_VERSION`. Old version content stays in place — no migration, no breaking URLs.

### Version Selector

The docs layout includes a version dropdown. It preserves the current slug when switching versions. If a page doesn't exist in the target version, it falls back to the version's index.

```tsx
// app/docs/layout.tsx
import { ALL_VERSIONS, LATEST_VERSION } from '@/lib/docs'

export default function DocsLayout({ children }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <label htmlFor="version" className="text-sm text-gray-500">Version:</label>
        <VersionSelector versions={ALL_VERSIONS} latest={LATEST_VERSION} />
      </div>
      {children}
    </div>
  )
}
```

`VersionSelector` is a `'use client'` component that reads the current path and swaps the version segment.

### Sidebar Filtering

The sidebar layout inside `[version]/` filters docs to the current version:

```tsx
// app/docs/[version]/layout.tsx
import { allDocs } from 'content-collections'

export default async function VersionedDocsLayout({ children, params }) {
  const { version } = await params
  const versionDocs = allDocs
    .filter((d) => d.version === version)
    .sort((a, b) => a.order - b.order)

  const sections = groupBy(versionDocs, 'section')

  return (
    <div className="flex">
      <nav className="w-64 shrink-0">
        {Object.entries(sections).map(([section, docs]) => (
          <div key={section}>
            {section && <h3>{section}</h3>}
            <ul>
              {docs.map((doc) => (
                <li key={doc._meta.path}>
                  <Link href={`/docs/${version}/${doc._meta.fileName}`}>
                    {doc.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
```

### Design Decisions

**Why URL-prefix versioning, not query params or a toggle?**
- Each version has a distinct, linkable, cacheable URL
- Search engines index version-specific content
- Old links never break — `/docs/v1/routing` works forever
- Middleware handles all the redirect logic with zero client JS

**Why `latest` redirects instead of rendering directly?**
- One canonical URL per page (SEO)
- Cache keys are unambiguous
- When `LATEST_VERSION` changes from v1 to v2, all `/docs/latest/*` links automatically point to v2 content with no stale caches

**Why content directories, not frontmatter `version` field?**
- Directory structure mirrors URL structure — predictable
- Easy to copy an entire version: `cp -r content/docs/v1 content/docs/v2`
- No risk of frontmatter typos creating phantom versions

---

## Cross-References

- [Platform & Configuration](11-platform.md) — `output: 'server'`, adapters
- [Forms & Server Actions](08-forms-and-actions.md) — `createActionClient`, progressive enhancement
- [Content Collections & MDX](20-content-collections.md) — Collection schemas, MDX rendering, `generateStaticParams`
- [Routing & Middleware](07-routing.md) — File-system routing, `middleware.ts`, `<Link>`
- [Metadata](16-metadata.md) — Title templates, `generateMetadata`
- [Complete Examples](12-example.md) — Patterns used in the example routes
