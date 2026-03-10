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

timber.js uses [`content-collections`](https://www.content-collections.dev/) as the underlying engine for content scanning, schema validation, file watching, and code generation. This is a battle-tested library with built-in Vite support that handles the complex lifecycle of content processing. timber.js wraps it with a thin integration layer and provides a typed `@timber/app/content` API surface.

### Why Not Routes?

Route generation from content files (Astro-style `getStaticPaths`) conflates data and routing. In timber.js, the route tree is the file system under `app/`. Content is data. A page queries content and renders it. This keeps routing explicit and avoids the "where did this route come from?" confusion.

### Directory Convention

Collections live in a `content/` directory at the project root, sibling to `app/`:

```
content/
  blog/
    hello-world.mdx
    advanced-patterns.mdx
    react-server-components.md
  docs/
    getting-started.mdx
    api-reference.mdx
  changelog/
    v1.0.0.json
    v1.1.0.json
content-collections.ts   ← collection definitions
```

All collections are defined in a single `content-collections.ts` file at the project root. This is the standard content-collections convention. Each collection declaration specifies its `directory`, file `include` pattern, and Zod schema.

### Schema Definition

Collections are defined in `content-collections.ts` using `defineCollection` and `defineConfig` from `@content-collections/core`:

```ts
// content-collections.ts
import { defineCollection, defineConfig } from '@content-collections/core'
import { z } from 'zod'

const blog = defineCollection({
  name: 'blog',
  directory: 'content/blog',
  include: '**/*.mdx',
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

const changelog = defineCollection({
  name: 'changelog',
  directory: 'content/changelog',
  include: '**/*.json',
  parser: 'json',
  schema: z.object({
    version: z.string(),
    date: z.coerce.date(),
    changes: z.array(z.object({
      type: z.enum(['added', 'changed', 'fixed', 'removed']),
      description: z.string(),
    })),
  }),
})

export default defineConfig({
  content: [blog, changelog],
})
```

### content-collections API

content-collections provides the full collection lifecycle:

| Concept | API | Description |
|---------|-----|-------------|
| Define a collection | `defineCollection({ name, directory, include, schema, transform? })` | Declares a collection with Zod schema validation |
| Define config | `defineConfig({ content: [...] })` | Bundles collections into a single config |
| Transform entries | `transform` option | Optional transform function for computed fields |
| MDX compilation | `@content-collections/mdx` `compileMDX()` | Compiles MDX content bodies in transform step |
| Parsers | `parser: 'frontmatter' | 'json' | 'yaml'` | Built-in parsers for different file types. Default: `'frontmatter'` |

### MDX in Content Collections

For content collections with MDX files, use `@content-collections/mdx` to compile the MDX body in the transform step:

```ts
// content-collections.ts
import { defineCollection, defineConfig } from '@content-collections/core'
import { compileMDX } from '@content-collections/mdx'
import { z } from 'zod'

const blog = defineCollection({
  name: 'blog',
  directory: 'content/blog',
  include: '**/*.{mdx,md}',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
  transform: async (document, context) => {
    const mdx = await compileMDX(context, document)
    return {
      ...document,
      mdx,
    }
  },
})

export default defineConfig({
  content: [blog],
})
```

The compiled MDX code is stored as a string in the generated output. To render it as a React component, use `@content-collections/mdx/react`:

```tsx
import { useMDXComponent } from '@content-collections/mdx/react'

function BlogContent({ code }: { code: string }) {
  const MDXContent = useMDXComponent(code)
  return <MDXContent />
}
```

### Querying Collections

content-collections generates typed modules that are imported directly. The generated output is aliased to `content-collections` via Vite:

```ts
import { allBlogs, allChangelogs } from 'content-collections'

// allBlogs is Array<{ title: string; description: string; ... }>
// Fully typed based on the schema + transform
```

For timber.js, we also provide a convenience wrapper via `@timber/app/content` that re-exports the generated collections and adds timber-specific utilities:

```ts
import { allBlogs } from '@timber/app/content'

// Filter at query time
const published = allBlogs.filter((post) => !post.draft)

// Find a single entry by slug
const post = allBlogs.find((p) => p._meta.path === slug)
```

### Entry Metadata

Every content entry includes a `_meta` object with file metadata:

```ts
interface Meta {
  /** Relative file path from collection directory */
  filePath: string
  /** File name without extension */
  fileName: string
  /** Directory path relative to collection directory */
  directory: string
  /** File path without extension — use as slug */
  path: string
  /** File extension */
  extension: string
}
```

### Content and the Rendering Pipeline

Content that defines whether a page exists is **primary content** — it belongs outside `<Suspense>`. A blog post at `/blog/my-post` is the reason the page exists. If the post is missing, the correct response is a 404, not a loading spinner. See [Rendering Pipeline](02-rendering-pipeline.md).

```tsx
// app/blog/[slug]/page.tsx
import { allBlogs } from 'content-collections'
import { deny } from '@timber/app/server'

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = allBlogs.find((p) => p._meta.path === slug)
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
import { allBlogs } from 'content-collections'

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const post = allBlogs.find((p) => p._meta.path === slug)
  if (!post) return {}
  return {
    title: post.title,
    description: post.description,
    openGraph: {
      images: post.coverImage ? [post.coverImage] : [],
    },
  }
}
```

### Build-Time Processing

content-collections handles the full build lifecycle:

1. **Schema validation.** Every content file's frontmatter/data is validated against its collection's Zod schema. Validation failures are build errors with clear diagnostics: file path, field name, expected type, received value.

2. **Transform execution.** Transform functions (including MDX compilation) run after validation. Results are serialized to the generated output directory.

3. **Code generation.** content-collections generates typed JavaScript modules in `.content-collections/generated/`. The Vite plugin aliases `content-collections` to this directory, so imports resolve at build time with zero runtime cost.

In dev mode, content-collections watches for file changes and regenerates affected collections with HMR support via the Vite plugin.

### Dev Mode File Watching

The `@content-collections/vite` plugin handles file watching automatically:

- **New/deleted content file:** regenerate collection, invalidate dependent modules
- **Changed content file:** re-validate, re-transform, regenerate
- **Changed `content-collections.ts`:** rebuild all collections

### Caching

content-collections has built-in caching:

- **`'file'` cache (default):** Caches transform results to `.content-collections/cache/`. Only re-processes changed files on rebuild.
- **`'memory'` cache:** In-memory caching for dev mode.
- **`'none'`:** No caching, always reprocess.

Content collections are **local files only** in v1. For remote content (CMS, APIs), developers wrap their own fetch functions with `timber.cache`. See [Caching](06-caching.md).

### Content Collections and Routing

Content collections do **not** generate routes. Routes are always explicit `page.tsx` files. This is deliberate — see "Why Not Routes?" above.

Static export of content-driven routes uses `generateStaticParams()`, same as any dynamic route:

```tsx
// app/blog/[slug]/page.tsx
import { allBlogs } from 'content-collections'

export async function generateStaticParams() {
  return allBlogs
    .filter((p) => !p.draft)
    .map((post) => ({ slug: post._meta.path }))
}
```

---

## Complete Example

```
project/
  content/
    blog/
      hello-world.mdx
      advanced-patterns.mdx
  app/
    blog/
      page.tsx              ← blog index
      [slug]/
        page.tsx            ← individual post
    layout.tsx
  mdx-components.tsx
  content-collections.ts
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
// content-collections.ts
import { defineCollection, defineConfig } from '@content-collections/core'
import { compileMDX } from '@content-collections/mdx'
import { z } from 'zod'

const blog = defineCollection({
  name: 'blog',
  directory: 'content/blog',
  include: '**/*.{mdx,md}',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
  transform: async (document, context) => {
    const mdx = await compileMDX(context, document)
    return {
      ...document,
      mdx,
    }
  },
})

export default defineConfig({
  content: [blog],
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
import { allBlogs } from 'content-collections'
import Link from '@timber/app/link'

export const metadata = { title: 'Blog' }

export default async function BlogIndex() {
  const posts = allBlogs
    .filter((p) => !p.draft)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())

  return (
    <ul>
      {posts.map((post) => (
        <li key={post._meta.path}>
          <Link href={`/blog/${post._meta.path}`}>
            <h2>{post.title}</h2>
            <p>{post.description}</p>
            <time dateTime={post.publishedAt.toISOString()}>
              {post.publishedAt.toLocaleDateString()}
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
import { allBlogs } from 'content-collections'
import { useMDXComponent } from '@content-collections/mdx/react'
import { deny } from '@timber/app/server'
import type { Metadata } from '@timber/app/server'

export async function generateStaticParams() {
  return allBlogs
    .filter((p) => !p.draft)
    .map((post) => ({ slug: post._meta.path }))
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const post = allBlogs.find((p) => p._meta.path === slug)
  if (!post) return {}
  return { title: post.title, description: post.description }
}

function BlogContent({ code }: { code: string }) {
  const MDXContent = useMDXComponent(code)
  return <MDXContent />
}

export default async function BlogPost(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const post = allBlogs.find((p) => p._meta.path === slug)
  if (!post) deny(404)

  return (
    <article>
      <header>
        <h1>{post.title}</h1>
        <time dateTime={post.publishedAt.toISOString()}>
          {post.publishedAt.toLocaleDateString()}
        </time>
        <div>{post.tags.map((t) => <span key={t}>#{t}</span>)}</div>
      </header>
      <div className="prose">
        <BlogContent code={post.mdx} />
      </div>
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
| `timber-mdx` | `buildStart`, `resolveId`, `load`, `transform` | Detects MDX usage, registers `@mdx-js/rollup`, finds `mdx-components.tsx` |
| `timber-content` | `config`, `configResolved`, `buildStart`, `resolveId`, `load`, `transform`, `configureServer` | Wraps `@content-collections/vite`, detects `content/` directory, configures aliases |

`timber-mdx` is intentionally minimal — its job is to wire `@mdx-js/rollup` with the right options. The heavy lifting is done by the unified ecosystem.

`timber-content` wraps `@content-collections/vite` and activates only when a `content-collections.ts` config file exists at the project root. It delegates all scanning, validation, code generation, and file watching to content-collections.

### File Decomposition

| File | Responsibility | Budget |
|------|---------------|--------|
| `plugins/mdx.ts` | `timber-mdx` plugin | ~100 lines |
| `plugins/content.ts` | `timber-content` plugin — wraps `@content-collections/vite` | ~80 lines |
| `content/index.ts` | Re-exports from generated `content-collections`, timber-specific utilities | ~50 lines |

The implementation is significantly simpler than a custom scanner because content-collections handles:
- File scanning and glob matching
- Frontmatter parsing (gray-matter built in)
- Schema validation (Zod / Standard Schema)
- Transform pipeline with caching
- Code generation to `.content-collections/generated/`
- Dev mode file watching and HMR
- JSON/YAML/frontmatter parsing

### Dependencies

| Package | Type | Purpose |
|---------|------|---------|
| `@content-collections/core` | peer dependency | Collection definition, scanning, validation, code generation |
| `@content-collections/vite` | peer dependency | Vite plugin integration, aliases, dev watching |
| `@content-collections/mdx` | peer dependency (optional) | MDX compilation in content collection transforms |
| `@mdx-js/rollup` | peer dependency | MDX route pages (`.mdx` in `app/`) |
| `zod` | peer dependency | Schema validation (used by content-collections) |

All peer dependencies produce clear build errors with install instructions if missing when the relevant feature is activated. `@content-collections/mdx` is only needed if content collections use MDX transforms.

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

No content-specific config is added to `TimberUserConfig` — content-collections is configured entirely through its own `content-collections.ts` file.

### Cross-References

- [Routing](07-routing.md) — Page Extensions, MDX as valid route segments
- [Build System](18-build-system.md) — Plugin decomposition, virtual module patterns
- [Caching](06-caching.md) — `timber.cache` for remote content caching
- [Metadata](16-metadata.md) — `generateMetadata` integration with content data
- [Rendering Pipeline](02-rendering-pipeline.md) — Content renders as RSC, primary vs secondary content distinction
