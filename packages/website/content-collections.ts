import { defineCollection, defineConfig } from '@content-collections/core';
import { compileMDX } from '@content-collections/mdx';
import rehypePrettyCode from 'rehype-pretty-code';
import remarkGfm from 'remark-gfm';
import { z } from 'zod/v4';

/** Slugify a string: lowercase, replace non-alphanumeric with hyphens, collapse. */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Parse order number from filename prefix (e.g. "01-getting-started.mdx" → 1). */
function parseOrder(fileName: string): number {
  const match = fileName.match(/^(\d+)-/);
  return match ? parseInt(match[1], 10) : 999;
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
  }),
  transform: async (document, context) => {
    const mdx = await compileMDX(context, document, {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [
        [
          rehypePrettyCode,
          {
            theme: 'github-dark',
            keepBackground: false,
          },
        ],
      ],
    });
    const order = parseOrder(document._meta.fileName);
    const slug = document.slug ?? slugify(document.title);
    return { ...document, mdx, version: document._meta.directory, order, slug };
  },
});

export default defineConfig({
  content: [docs],
});
