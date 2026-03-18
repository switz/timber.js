import rehypeShiki from '@shikijs/rehype';
import { cloudflare } from '@timber-js/app/adapters/cloudflare';
import remarkGfm from 'remark-gfm';
import { createTwoslashTransformer } from './lib/twoslash-config.ts';

export default {
  output: 'server' as const,
  pageExtensions: ['tsx', 'ts', 'mdx'],
  mdx: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      [
        rehypeShiki,
        {
          theme: 'monokai',
          keepBackground: true,
          transformers: [createTwoslashTransformer()],
        },
      ],
    ],
  },
  // clientJavascript: { disabled: true, enableHMRInDev: true },
  adapter: cloudflare({
    wrangler: { name: 'timberjs-website' },
  }),
};
