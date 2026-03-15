import { defineCollection, defineConfig } from '@content-collections/core';
import { z } from 'zod/v4';

/** Slugify a string: lowercase, replace non-alphanumeric with hyphens, collapse. */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Parse order number from filename prefix (e.g. "01-getting-started.mdx" → 1, "05a-foo.mdx" → 5.01). */
function parseOrder(fileName: string): number {
  const match = fileName.match(/^(\d+)([a-z])?-/);
  if (!match) return 999;
  const base = parseInt(match[1], 10);
  const suffix = match[2] ? (match[2].charCodeAt(0) - 96) / 100 : 0;
  return base + suffix;
}

const docs = defineCollection({
  name: 'docs',
  directory: 'content/docs',
  include: '**/*.{mdx,md}',
  schema: z.object({
    content: z.string(),
    title: z.string(),
    description: z.string(),
    section: z.string(),
    slug: z.string().optional(),
    notAI: z.boolean().optional(),
  }),
  transform: async (document) => {
    const order = parseOrder(document._meta.fileName);
    const slug = document.slug ?? slugify(document.title);
    // Exclude raw markdown `content` — MDX is loaded via dynamic import() instead.
    const { content: _, ...metadata } = document;
    return { ...metadata, version: document._meta.directory, order, slug };
  },
});

const blog = defineCollection({
  name: 'blog',
  directory: 'content/blog',
  include: '**/*.{mdx,md}',
  schema: z.object({
    content: z.string(),
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    author: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
  transform: async (document) => {
    const { content: _, ...metadata } = document;
    return { ...metadata, slug: document._meta.path };
  },
});

export default defineConfig({
  content: [docs, blog],
});
