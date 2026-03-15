import rehypeShiki from '@shikijs/rehype';
import { cloudflare } from '@timber/app/adapters/cloudflare';
import remarkGfm from 'remark-gfm';

export default {
  output: 'server' as const,
  pageExtensions: ['tsx', 'ts', 'mdx'],
  mdx: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [[rehypeShiki, { theme: 'github-dark', keepBackground: true }]],
  },
  // clientJavascript: { disabled: true, enableHMRInDev: true },
  adapter: cloudflare({
    wrangler: { name: 'timberjs-website' },
  }),
};
