# Content Collections & MDX Rendering

## MDX Rendering

### The `timber-mdx` Plugin

The `timber-mdx` plugin integrates MDX into the Vite build pipeline. It delegates all MDX compilation to `@mdx-js/rollup` — the official Vite/Rollup MDX plugin maintained by the unified ecosystem. timber.js does not implement its own MDX compiler.

The plugin activates when either condition is met:

1. `pageExtensions` includes `'mdx'` or `'md'` in `timber.config.ts`
2. A `content/` directory exists at the project root

When active, the plugin registers `@mdx-js/rollup` as a nested Vite plugin via the `config` hook. This ensures MDX compilation happens before timber.js's other transforms.

```ts
// timber.config.ts — enabling MDX pages
export default {
  pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'],
}
```

`@mdx-js/rollup` is a **peer dependency**. If MDX is activated but the package is not installed, the build fails with a clear error message and install instructions.

### MDX Files Are Server Components

MDX files are RSC by default. They compile to React components that render on the server with zero client JavaScript. This follows from the existing design in [Routing](07-routing.md): `page.mdx` is a page, `layout.mdx` is a layout.

```
app/
  docs/
    getting-started/
      page.mdx          ← RSC, zero client JS
    api-reference/
      page.mdx
    layout.tsx           ← shared docs layout with nav
```

An MDX file can import and use client components. The MDX file itself stays server-side — only explicitly `'use client'` components ship to the browser.

```mdx
{/* app/docs/getting-started/page.mdx */}
import { CopyButton } from '../../components/copy-button'  {/* 'use client' component */}

# Getting Started

Install the package:

\```bash
pnpm add @timber/app
\```

<CopyButton text="pnpm add @timber/app" />
```

### Custom Components via `mdx-components.ts`

A project-wide `mdx-components.ts` (or `.tsx`) at the project root provides custom component mappings for all MDX files. This follows the same convention as Next.js.

```tsx
// mdx-components.tsx
import type { MDXComponents } from '@timber/app/server'

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    h1: (props) => <h1 className="text-3xl font-bold mt-8 mb-4" {...props} />,
    h2: (props) => <h2 className="text-2xl font-semibold mt-6 mb-3" {...props} />,
    pre: (props) => (
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto" {...props} />
    ),
    code: (props) => <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm" {...props} />,
    a: (props) => <a className="text-blue-600 underline" {...props} />,
  }
}
```

The `timber-mdx` plugin detects this file at startup and configures `@mdx-js/rollup` to use it as the provider source via the `providerImportSource` option.

### MDX Configuration

MDX compilation options are passed through `timber.config.ts`:

```ts
// timber.config.ts
import remarkGfm from 'remark-gfm'
import rehypeShiki from '@shikijs/rehype'

export default {
  pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'],
  mdx: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      [rehypeShiki, { theme: 'github-dark' }],
    ],
  },
}
```

The `mdx` config key maps directly to `@mdx-js/rollup` options (minus `providerImportSource`, which the framework controls). No abstraction over the underlying compiler.

| Option | Type | Description |
|--------|------|-------------|
| `remarkPlugins` | `PluggableList` | remark plugins for markdown AST transforms |
| `rehypePlugins` | `PluggableList` | rehype plugins for HTML AST transforms |
| `recmaPlugins` | `PluggableList` | recma plugins for ESTree transforms |
| `remarkRehypeOptions` | `object` | Options passed to `remark-rehype` |
| `development` | `boolean` | Auto-set: `true` in dev, `false` in build |

`remark-gfm`, `rehype-shiki`, and other remark/rehype plugins are the developer's choice — not bundled.

### Frontmatter

MDX frontmatter is extracted via `remark-frontmatter` + `remark-mdx-frontmatter` (auto-registered by the plugin when MDX is active). Frontmatter fields are available as named exports from the MDX module:

```mdx
---
title: Getting Started
description: Learn how to set up timber.js
---

# {title}

{description}
```

```tsx
// In a layout that reads frontmatter from a page
import { title, description } from './page.mdx'
```

For MDX route pages, frontmatter exports can serve as an implicit `metadata` export. When an MDX page has frontmatter fields `title` and/or `description`, the framework treats them as `export const metadata`. An explicit `export const metadata` in the MDX file overrides frontmatter-derived metadata. See [Metadata](16-metadata.md).

### Next.js Comparison

| Next.js | timber.js |
|---------|-----------|
| `@next/mdx` package | Built-in `timber-mdx` plugin |
| `mdx-components.tsx` at project root | Same convention |
| `next.config.mjs` `withMDX()` wrapper | `timber.config.ts` `mdx` key |
| MDX pages are client components by default | MDX pages are server components by default |
| Custom loader for `.md` files | `@mdx-js/rollup` handles both `.mdx` and `.md` |

---

## Content Collections

Content collections are a typed, file-based content system for managing structured content outside the route tree. Collections are data sources — they do not generate routes. Routing is explicit, through `page.tsx` files that query collections.

### Why Not Routes?

Route generation from content files (Astro-style `getStaticPaths`) conflates data and routing. In timber.js, the route tree is the file system under `app/`. Content is data. A page queries content and renders it. This keeps routing explicit and avoids the "where did this route come from?" confusion.

### Directory Convention

Collections live in a `content/` directory at the project root, sibling to `app/`:

```
content/
  blog/
    collection.ts        ← schema definition
    hello-world.mdx
    advanced-patterns.mdx
    react-server-components.md
  docs/
    collection.ts
    getting-started.mdx
    api-reference.mdx
  changelog/
    collection.ts
    v1.0.0.json
    v1.1.0.json
```

Each subdirectory of `content/` is a collection. Each collection has a `collection.ts` that defines the schema. Content files (`.mdx`, `.md`, `.json`, `.yaml`) sit alongside the schema.

### Schema Definition

`collection.ts` exports a collection definition created via `defineCollection()` from `@timber/app/content`. Schemas use Zod for frontmatter validation. Both `zod` and `gray-matter` are **peer dependencies** — only needed if using content collections.

```ts
// content/blog/collection.ts
import { defineCollection } from '@timber/app/content'
import { z } from 'zod'

export default defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    author: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    coverImage: z.string().optional(),
  }),
})
```

```ts
// content/changelog/collection.ts — data-only collection
import { defineCollection } from '@timber/app/content'
import { z } from 'zod'

export default defineCollection({
  type: 'data',
  schema: z.object({
    version: z.string(),
    date: z.coerce.date(),
    changes: z.array(z.object({
      type: z.enum(['added', 'changed', 'fixed', 'removed']),
      description: z.string(),
    })),
  }),
})
```

### Collection Types

| Type | Content files | Body | Use case |
|------|--------------|------|----------|
| `'content'` (default) | `.mdx`, `.md` | Rendered MDX/Markdown body | Blog posts, docs, guides |
| `'data'` | `.json`, `.yaml`, `.yml` | None | Changelogs, team members, config data |

### `defineCollection` API

```ts
interface CollectionConfig<T extends z.ZodType> {
  type?: 'content' | 'data'    // default: 'content'
  schema: T                     // Zod schema for frontmatter (content) or full document (data)
}

function defineCollection<T extends z.ZodType>(
  config: CollectionConfig<T>
): CollectionDefinition<z.infer<T>>
```

### Querying Collections

Collections are queried via `getCollection()` and `getEntry()` from `@timber/app/content`. These are async, typed, and designed for RSC.

```ts
import { getCollection, getEntry } from '@timber/app/content'

// Get all entries in a collection
const posts = await getCollection('blog')
// Type: Array<ContentEntry<{ title: string; description: string; publishedAt: Date; ... }>>

// Filter at query time
const published = await getCollection('blog', (entry) => !entry.data.draft)

// Get a single entry by slug
const post = await getEntry('blog', 'hello-world')
// Type: ContentEntry<{ title: string; ... }> | undefined
```

### `ContentEntry` Type

```ts
interface ContentEntry<T> {
  /** The collection name */
  collection: string
  /** The slug (filename without extension) */
  slug: string
  /** Validated frontmatter/data, typed by the collection schema */
  data: T
  /** The raw content body (MDX/Markdown source). Undefined for 'data' collections */
  body?: string
  /** Render the content body to a React element. Only for 'content' collections */
  render(): Promise<React.ReactElement>
  /** Absolute file path (available in server context only) */
  filePath: string
}
```

### Rendering Content

The `render()` method on a content entry returns a React element (RSC) that can be placed directly in the component tree:

```tsx
// app/blog/[slug]/page.tsx
import { getEntry } from '@timber/app/content'
import { deny } from '@timber/app/server'

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getEntry('blog', slug)
  if (!post) deny(404)

  const content = await post.render()
  return (
    <article>
      <h1>{post.data.title}</h1>
      <time dateTime={post.data.publishedAt.toISOString()}>
        {post.data.publishedAt.toLocaleDateString()}
      </time>
      <div className="prose">
        {content}
      </div>
    </article>
  )
}
```

`render()` compiles the MDX/Markdown at build time (production) or on demand (dev). The result is an RSC element — server-rendered with zero client JS unless the content uses `'use client'` components. Custom components from `mdx-components.tsx` are applied automatically.

### Content and the Rendering Pipeline

Content that defines whether a page exists is **primary content** — it belongs outside `<Suspense>`. A blog post at `/blog/my-post` is the reason the page exists. If the post is missing, the correct response is a 404, not a loading spinner. See [Rendering Pipeline](02-rendering-pipeline.md).

```tsx
// Correct: post fetch outside Suspense, 404 if missing
export default async function BlogPost({ params }) {
  const { slug } = await params
  const post = await getEntry('blog', slug)
  if (!post) deny(404)
  // ...
}
```

Secondary content — like "related posts" or "recent articles" sidebar — can be wrapped in `<Suspense>` or `<DeferredSuspense>`.

### Metadata from Content

`generateMetadata` reads content entry data directly:

```tsx
// app/blog/[slug]/page.tsx
import type { Metadata } from '@timber/app/server'
import { getEntry } from '@timber/app/content'

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const post = await getEntry('blog', slug)
  if (!post) return {}
  return {
    title: post.data.title,
    description: post.data.description,
    openGraph: {
      images: post.data.coverImage ? [post.data.coverImage] : [],
    },
  }
}
```

### Type Generation

The `timber-content` plugin generates TypeScript declarations at build/dev time from the `content/` directory:

```ts
// .timber/content.d.ts (generated — do not edit)
declare module '@timber/app/content' {
  interface CollectionMap {
    blog: {
      title: string
      description: string
      publishedAt: Date
      author: string
      tags: string[]
      draft: boolean
      coverImage?: string
    }
    docs: {
      title: string
      description: string
      order: number
    }
    changelog: {
      version: string
      date: Date
      changes: Array<{ type: 'added' | 'changed' | 'fixed' | 'removed'; description: string }>
    }
  }
}
```

This makes `getCollection('blog')` and `getEntry('blog', slug)` fully typed without manual type annotations. Collection names that don't exist are TypeScript errors.

### Build-Time Processing

Content collections are processed at build time:

1. **Schema validation.** Every content file's frontmatter is validated against its collection's Zod schema. Validation failures are build errors with clear diagnostics: file path, field name, expected type, received value.

2. **MDX compilation.** All `.mdx` and `.md` files in content collections are compiled to JavaScript modules. The compiled modules are included in the RSC build output.

3. **Content manifest.** A virtual module `virtual:timber-content-manifest` is generated containing the collection index: slug-to-module mappings, validated frontmatter data, and lazy import functions for rendered content.

In dev mode, content files are compiled on demand (not eagerly) and the manifest is regenerated on file change with HMR support.

### Dev Mode File Watching

The `timber-content` plugin watches the `content/` directory:

- **New/deleted content file:** regenerate manifest, invalidate `virtual:timber-content-manifest`
- **Changed content file:** recompile MDX, invalidate cache tag `content:<collection>:<slug>`
- **Changed `collection.ts`:** re-validate all entries in that collection, regenerate types

### Caching

- **Production:** Content is compiled and validated at build time. `getCollection()` and `getEntry()` read from the build manifest — no runtime cost.
- **Dev mode:** Content is compiled on demand. Queries are `timber.cache`-wrapped with tag `content:<collection>` for efficient invalidation on file change.

Content collections are **local files only** in v1. For remote content (CMS, APIs), developers wrap their own fetch functions with `timber.cache`. See [Caching](06-caching.md).

### Content Collections and Routing

Content collections do **not** generate routes. Routes are always explicit `page.tsx` files. This is deliberate — see "Why Not Routes?" above.

Static export of content-driven routes uses `generateStaticParams()`, same as any dynamic route:

```tsx
// app/blog/[slug]/page.tsx
import { getCollection } from '@timber/app/content'

export async function generateStaticParams() {
  const posts = await getCollection('blog', (e) => !e.data.draft)
  return posts.map((post) => ({ slug: post.slug }))
}
```

---

## Complete Example

```
project/
  content/
    blog/
      collection.ts
      hello-world.mdx
      advanced-patterns.mdx
  app/
    blog/
      page.tsx              ← blog index
      [slug]/
        page.tsx            ← individual post
    layout.tsx
  mdx-components.tsx
  timber.config.ts
```

```ts
// timber.config.ts
import remarkGfm from 'remark-gfm'

export default {
  pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'],
  mdx: {
    remarkPlugins: [remarkGfm],
  },
}
```

```ts
// content/blog/collection.ts
import { defineCollection } from '@timber/app/content'
import { z } from 'zod'

export default defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
})
```

```mdx
---
title: Hello World
description: My first blog post with timber.js
publishedAt: 2025-01-15
tags: [intro, timber]
---

# Hello World

This is my first post. It supports **GFM** thanks to `remark-gfm`.

| Feature | Status |
|---------|--------|
| MDX pages | ✓ |
| Content collections | ✓ |
```

```tsx
// app/blog/page.tsx
import { getCollection } from '@timber/app/content'
import Link from '@timber/app/link'

export const metadata = { title: 'Blog' }

export default async function BlogIndex() {
  const posts = await getCollection('blog', (e) => !e.data.draft)
  const sorted = posts.sort(
    (a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime()
  )

  return (
    <ul>
      {sorted.map((post) => (
        <li key={post.slug}>
          <Link href={`/blog/${post.slug}`}>
            <h2>{post.data.title}</h2>
            <p>{post.data.description}</p>
            <time dateTime={post.data.publishedAt.toISOString()}>
              {post.data.publishedAt.toLocaleDateString()}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

```tsx
// app/blog/[slug]/page.tsx
import { getEntry, getCollection } from '@timber/app/content'
import { deny } from '@timber/app/server'
import type { Metadata } from '@timber/app/server'

export async function generateStaticParams() {
  const posts = await getCollection('blog', (e) => !e.data.draft)
  return posts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const post = await getEntry('blog', slug)
  if (!post) return {}
  return { title: post.data.title, description: post.data.description }
}

export default async function BlogPost(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const post = await getEntry('blog', slug)
  if (!post) deny(404)

  const content = await post.render()
  return (
    <article>
      <header>
        <h1>{post.data.title}</h1>
        <time dateTime={post.data.publishedAt.toISOString()}>
          {post.data.publishedAt.toLocaleDateString()}
        </time>
        <div>{post.data.tags.map((t) => <span key={t}>#{t}</span>)}</div>
      </header>
      <div className="prose">{content}</div>
    </article>
  )
}
```

---

## Implementation Architecture

### Plugin Decomposition

Two plugins are added to the `timber()` array:

| Plugin | Hooks | Responsibility |
|--------|-------|---------------|
| `timber-mdx` | `config`, `buildStart` | Detects MDX usage, registers `@mdx-js/rollup`, finds `mdx-components.tsx` |
| `timber-content` | `resolveId`, `load`, `buildStart`, `configureServer` | Scans `content/`, validates schemas, generates manifest virtual module, generates types |

`timber-mdx` is intentionally minimal — its job is to wire `@mdx-js/rollup` with the right options. The heavy lifting is done by the unified ecosystem.

`timber-content` follows the same pattern as `timber-routing`: scan a directory, build a manifest, serve it as a virtual module, watch for changes in dev.

### File Decomposition

| File | Responsibility | Budget |
|------|---------------|--------|
| `plugins/mdx.ts` | `timber-mdx` plugin | ~100 lines |
| `plugins/content.ts` | `timber-content` plugin (Vite hooks) | ~200 lines |
| `content/scanner.ts` | Content directory scanner, frontmatter extraction | ~200 lines |
| `content/types.ts` | TypeScript types for entries, collections, manifest | ~80 lines |
| `content/runtime.ts` | `getCollection()`, `getEntry()`, `defineCollection()` | ~150 lines |
| `content/codegen.ts` | Type declaration generation for `.timber/content.d.ts` | ~100 lines |

### Virtual Module

`virtual:timber-content-manifest` contains:

```ts
// Auto-generated content manifest
export default {
  blog: {
    type: 'content',
    entries: {
      'hello-world': {
        slug: 'hello-world',
        data: { title: 'Hello World', /* ... */ },
        load: () => import('/path/to/content/blog/hello-world.mdx'),
        filePath: '/path/to/content/blog/hello-world.mdx',
      },
      // ...
    },
  },
}
```

The `load()` function returns the compiled MDX module lazily. For `'data'` collections, the data is inlined directly.

### Peer Dependencies

| Package | When needed | Purpose |
|---------|-------------|---------|
| `@mdx-js/rollup` | MDX pages or content collections with `.mdx` files | MDX compilation |
| `zod` | Content collections | Schema validation |
| `gray-matter` | Content collections | Frontmatter extraction |

All three produce clear build errors with install instructions if missing when the relevant feature is activated.

### Config Type Extension

```ts
// Added to TimberUserConfig
interface TimberUserConfig {
  // ... existing fields ...
  mdx?: {
    remarkPlugins?: PluggableList
    rehypePlugins?: PluggableList
    recmaPlugins?: PluggableList
    remarkRehypeOptions?: Record<string, unknown>
  }
}
```

### Cross-References

- [Routing](07-routing.md) — Page Extensions, MDX as valid route segments
- [Build System](18-build-system.md) — Plugin decomposition, virtual module patterns
- [Caching](06-caching.md) — `timber.cache` for content query caching in dev
- [Metadata](16-metadata.md) — `generateMetadata` integration with content data
- [Rendering Pipeline](02-rendering-pipeline.md) — Content renders as RSC, primary vs secondary content distinction
