import { defineCollection, defineConfig } from '@content-collections/core';
import { compileMDX } from '@content-collections/mdx';
import { z } from 'zod/v4';

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
  transform: async (document, context) => {
    const mdx = await compileMDX(context, document);
    return {
      ...document,
      mdx,
    };
  },
});

const changelog = defineCollection({
  name: 'changelog',
  directory: 'content/changelog',
  include: '**/*.json',
  parser: 'json',
  schema: z.object({
    content: z.string().optional(),
    version: z.string(),
    date: z.coerce.date(),
    changes: z.array(
      z.object({
        type: z.enum(['added', 'changed', 'fixed', 'removed']),
        description: z.string(),
      })
    ),
  }),
});

export default defineConfig({
  content: [blog, changelog],
});
