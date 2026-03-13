import { cloudflare } from '@timber/app/adapters/cloudflare';

export default {
  output: 'server' as const,
  noClientJavascript: true,
  adapter: cloudflare({
    wrangler: { name: 'timberjs-website' },
  }),
};
