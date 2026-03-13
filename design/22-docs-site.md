# Docs & Marketing Site

## Purpose

timber.js needs a public-facing documentation and marketing site. The site is a timber.js app itself — it dogfoods the framework, demonstrates real patterns, and serves as a living reference for how to build with timber.js.

The site uses `output: 'server'` so it can showcase forms, server actions, middleware, and other server-side features that a static export would strip away. It runs on Cloudflare Workers alongside the framework it documents.

This will be deployed to https://timberjs.com on cloudflare pages - which we own on Cloudflare.

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
      version-selector.tsx      # 'use client' — version dropdown
      copy-button.tsx           # 'use client' — code block copy
      package-manager-tabs.tsx  # 'use client' — npm/pnpm/yarn tabs
    docs/
      layout.tsx                # Outer docs chrome (version selector)
      page.tsx                  # Redirects to /docs/latest
      [slug]/
        middleware.ts           # Redirects /docs/foo → /docs/latest/foo
      [version]/
        layout.tsx              # Sidebar nav (filtered to this version)
        page.tsx                # Version index (brief intro, sidebar navigates)
        [slug]/
          page.tsx              # Individual doc page
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
      v1/
        getting-started.mdx
        configuration.mdx
        routing.mdx
    blog/
      hello-world.mdx

  lib/
    docs.ts                 # LATEST_VERSION, ALL_VERSIONS constants
    utils.ts                # groupBy helper, cn() for shadcn

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
    remarkPlugins: [], // add remark-gfm, etc. as needed
    rehypePlugins: [],
  },
};
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
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { timber } from '../../packages/timber-app/src/index';
import tailwindcss from '@tailwindcss/vite';

const root = resolve(import.meta.dirname, '../..');

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
});
```

### Styling

Tailwind v4 via `@tailwindcss/vite`. Zero-config — no `tailwind.config.js` or `postcss.config.js`. Same setup as `examples/tailwind`.

```css
/* app/globals.css */
@import 'tailwindcss';

@theme {
  --color-timber: #2d5016;
  --color-timber-light: #4a7c28;
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

Font loading (Inter, JetBrains Mono) is handled by the framework-level font system — see [Fonts & Web Font Loading](24-fonts.md). The `--font-sans` and `--font-mono` declarations reference fonts that timber's font pipeline makes available.

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
    order: z.number(), // sidebar sort order
    section: z.string().optional(), // grouping: "Getting Started", "API", etc.
  }),
  transform: async (document, context) => {
    const mdx = await compileMDX(context, document);
    return { ...document, mdx };
  },
});
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
    const mdx = await compileMDX(context, document);
    return { ...document, mdx };
  },
});
```

---

## Routes

### `/` — Landing Page

Marketing page. Hero section with tagline and CTA. Feature grid highlighting timber.js design values:

| Feature                 | Copy                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Correct HTTP            | Real status codes, real headers. No more 200-for-everything.                           |
| No loading spinners     | Primary content renders before the shell flushes. Pages arrive complete.               |
| Vite-native             | Built on Vite 7. ESM-first. Sub-second HMR.                                            |
| Deploy anywhere         | Servers, serverless, edge, or static. Adapters for Node, Cloudflare, Vercel, and more. |
| Server actions          | Forms that work without JavaScript. Progressive enhancement by default.                |
| React Server Components | Server-rendered by default. Client JS only where you ask for it.                       |

No animations. No JavaScript for the landing page beyond hydration.

### `/docs` — Documentation

Versioned docs with sidebar navigation. See [Doc Versioning](#doc-versioning) for full route structure, content organization, and code examples.

`/docs` redirects to `/docs/latest`. `/docs/v1` (version with no slug) shows a brief version index page with the sidebar providing navigation. Each doc page renders MDX content with the AI-generated content banner.

## Writing Style

Docs and pages should be written in a serious but informal tone. They should convey an air of authority, confidence, but friendliness and the occasionally cheekiness. They should be clear, concise, and not use more description than necessary to get the point across. They should never be critical or denigrating towards alternatives like nextjs and vinext, nor should they hold these comparisons with great reverence. Nextjs is a valuable and powerful framework and this would not exist without it, but we feel divergent design decisions make this framework easier to use and understand, and aligns better with our intended usage. This is not a framework for everyone, nor for every use case. Next is far more mature and battle-tested.

These docs will be replaced by hand-written docs. This is just for us to get something up and help us organize our thoughts. Before we launch publicly they will _all_ be re-written. For future readers of this document, please understand that I too find the fact that I am writing this description completely absurd and somewhat embarassing. The real website will be entirely hand-written.

Code samples should be rendered with Bright.js (rsc code block - https://github.com/code-hike/bright) with proper syntax highlighting. Code blocks should have copying. `npm install` should have support for `pnpm`/`yarn`/`npm` using client components.

In general you should use `<Link` components for anchor tags.

## Components

Avoid pulling in external components unless they are shadcn related. If we need some re-usable components, install shadcn and the related packages.

## Light Mode/Dark Mode

The docs site should have a light mode and a dark mode and only be rendered based on the users preferred style (css). Don't do any javascript based detection.

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
'use client';
import { useActionState } from 'react';
import { submitContact } from './actions';

export default function ContactPage() {
  const [state, action, pending] = useActionState(submitContact, null);

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
  );
}
```

```ts
// app/examples/contact/actions.ts
'use server';
import { action } from '@/lib/action';
import { z } from 'zod/v4';

export const submitContact = action
  .schema(
    z.object({
      email: z.string().email(),
      message: z.string().min(10).max(1000),
    })
  )
  .action(async ({ input }) => {
    // In production: send email, store in DB, etc.
    console.log('Contact form submission:', input);
    return { success: true };
  });
```

### `/examples/newsletter` — Newsletter Signup Demo

Minimal form demonstrating progressive enhancement — a single email input that works as a plain `<form>` without JavaScript and enhances with `useActionState` when JS loads.

---

## Network boundary, streaming, and shell

The core design to get across here is getting users to understand that _all_ websites are built across the network boundary. We have two environments (server and client) and all existing frameworks (SPAs, htmx, rails, universal SSR etc.) tend to pretend one or the other doesn't exist. Since RSCs are streaming-compatible, we can stream our HTML and JS as it's ready with one caveat. Stream too early and you lose HTTP status codes, no-js forms, etc etc.

So it's important for users to understand why RSCs handle both sides of the network boundary. What streaming and flush-points are. And how this framework gives visiblity into both through logging and clarity of surface APIs.

This is more of guide-level than docs-level, but we'll need both on our docs site.

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
  );
}
```

This component is imported in `app/docs/[slug]/page.tsx` and rendered above the MDX content. Blog posts do not get this banner — blog content is editorial.

---

## Root Layout

```tsx
// app/layout.tsx
import { Link } from '@timber/app/client';
import './globals.css';

export const metadata = {
  title: {
    template: '%s | timber.js',
    default: 'timber.js — Vite-native React framework',
  },
  description:
    'A web framework built on Vite and React Server Components. Correct HTTP semantics, real status codes, pages that work without JavaScript.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <header className="border-b">
          <nav className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link href="/" className="font-bold text-lg">
              timber.js
            </Link>
            <div className="flex gap-6">
              <Link href="/docs">Docs</Link>
              <Link href="/blog">Blog</Link>
              <a href="https://github.com/AshMartian/timber-js" target="_blank" rel="noopener">
                GitHub
              </a>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="border-t mt-16 py-8">
          <div className="max-w-6xl mx-auto px-4 text-sm text-gray-500">timber.js</div>
        </footer>
      </body>
    </html>
  );
}
```

---

## Dependencies

```json
{
  "dependencies": {
    "@timber/app": "workspace:*",
    "bright": "^0.8.5",
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

- **Visual design.** Color palette, typography scale, and page layouts will be iterated on after scaffolding is in place. Choose some basic good tenants for now without going too far.
- **Search.** Full-text doc search is a future feature. Not needed for scaffolding.
- **Font loading.** How fonts are loaded (Inter, JetBrains Mono) is a framework-level concern — see [Fonts & Web Font Loading](24-fonts.md).
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

`/docs/latest/getting-started` is an alias that renders the latest docs inline — no redirect. The page resolves `latest` to `LATEST_VERSION` for content lookup but serves the response at the `/docs/latest/` URL. `/docs/getting-started` (no version prefix) redirects to `/docs/latest/getting-started`.

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
      page.tsx                        # Version index (brief intro, sidebar navigates)
      [slug]/
        page.tsx                      # Individual doc page
```

**Why `[slug]` and `[version]` don't conflict:** Both are dynamic segments at the same level under `docs/`, but they match different URL depths. A request for `/docs/routing` (one segment) matches `[slug]/middleware.ts`. A request for `/docs/v1/routing` (two segments) matches `[version]/[slug]/page.tsx`. The router resolves these unambiguously based on segment count — see [Route Matching](07-routing.md#route-matching).

### Middleware for Redirects

```ts
// app/docs/[slug]/middleware.ts
// Catches /docs/getting-started (no version) and redirects to latest
import { redirect } from '@timber/app/server';
import { LATEST_VERSION } from '@/lib/docs';

export default async function middleware(ctx) {
  redirect(`/docs/${LATEST_VERSION}/${ctx.params.slug}`);
}
```

The `[slug]` route exists only for the redirect — it has no `page.tsx`. The `[version]/[slug]` route handles actual rendering.

```ts
// app/docs/[version]/[slug]/page.tsx
import { allDocs } from 'content-collections';
import { deny } from '@timber/app/server';
import { LATEST_VERSION } from '@/lib/docs';

export default async function DocPage({ params }) {
  const { version, slug } = await params;

  // Resolve "latest" to the actual version for content lookup — no redirect.
  // The URL stays as /docs/latest/routing.
  const resolvedVersion = version === 'latest' ? LATEST_VERSION : version;

  const doc = allDocs.find((d) => d.version === resolvedVersion && d._meta.fileName === slug);
  if (!doc) deny(404);

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
    const mdx = await compileMDX(context, document);
    // _meta.directory is "v1", "v2", etc.
    return { ...document, mdx, version: document._meta.directory };
  },
});
```

### Version Configuration

A single constant defines the current version:

```ts
// lib/docs.ts
export const LATEST_VERSION = 'v1';
export const ALL_VERSIONS = ['v1'] as const;
```

When v2 ships, add it to `ALL_VERSIONS` and update `LATEST_VERSION`. Old version content stays in place — no migration, no breaking URLs.

### Version Selector

The docs layout includes a version dropdown. It preserves the current slug when switching versions. If a page doesn't exist in the target version, it falls back to the version's index.

```tsx
// app/docs/layout.tsx
import { ALL_VERSIONS, LATEST_VERSION } from '@/lib/docs';

export default function DocsLayout({ children }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <label htmlFor="version" className="text-sm text-gray-500">
          Version:
        </label>
        <VersionSelector versions={ALL_VERSIONS} latest={LATEST_VERSION} />
      </div>
      {children}
    </div>
  );
}
```

`VersionSelector` is a `'use client'` component that reads the current path and swaps the version segment.

### Version Index Page

`/docs/v1` (version with no slug) renders a brief intro page. The sidebar provides navigation to individual docs — this page does not duplicate the sidebar as a table of contents.

```tsx
// app/docs/[version]/page.tsx
import { LATEST_VERSION } from '@/lib/docs';

export default async function VersionIndex({ params }) {
  const { version } = await params;
  const resolvedVersion = version === 'latest' ? LATEST_VERSION : version;

  return (
    <div className="prose dark:prose-invert">
      <h1>timber.js {resolvedVersion} Documentation</h1>
      <p>Select a topic from the sidebar to get started.</p>
    </div>
  );
}
```

### Sidebar Filtering

The sidebar layout inside `[version]/` filters docs to the current version:

```tsx
// app/docs/[version]/layout.tsx
import { allDocs } from 'content-collections';
import { LATEST_VERSION } from '@/lib/docs';

export default async function VersionedDocsLayout({ children, params }) {
  const { version } = await params;
  const resolvedVersion = version === 'latest' ? LATEST_VERSION : version;
  const versionDocs = allDocs
    .filter((d) => d.version === resolvedVersion)
    .sort((a, b) => a.order - b.order);

  const sections = groupBy(versionDocs, 'section');

  return (
    <div className="flex">
      <nav className="w-64 shrink-0">
        {Object.entries(sections).map(([section, docs]) => (
          <div key={section}>
            {section && <h3>{section}</h3>}
            <ul>
              {docs.map((doc) => (
                <li key={doc._meta.path}>
                  <Link href={`/docs/${version}/${doc._meta.fileName}`}>{doc.title}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
```

### Extra Content

All of these should include the AI header.

- Create a docs page explaining _why timber_?
- Create a docs page comparing timber to nextjs
- Create a docs page comparing timber to other RSC frameworks (Vinext, Remix, etc.)

### Design Decisions

**Why URL-prefix versioning, not query params or a toggle?**

- Each version has a distinct, linkable, cacheable URL
- Search engines index version-specific content
- Old links never break — `/docs/v1/routing` works forever
- Middleware handles all the redirect logic with zero client JS

**Why `latest` renders in-place instead of redirecting?**

- `/docs/latest/routing` is a stable, shareable URL that always shows current docs
- No redirect chain — faster page loads
- When `LATEST_VERSION` changes from v1 to v2, `/docs/latest/*` URLs serve v2 content automatically
- Versioned URLs (`/docs/v1/routing`) still work forever for pinned references

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
- [Metadata](16-metadata.md) — Title templates, dynamic `metadata()`
- [Complete Examples](12-example.md) — Patterns used in the example routes
- [Fonts & Web Font Loading](24-fonts.md) — Framework-level font optimization
