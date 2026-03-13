import { cloudflare } from '@timber/app/adapters/cloudflare';

export default {
  output: 'server' as const,
  clientJavascript: { disabled: true, enableHMRInDev: true },
  adapter: cloudflare({
    wrangler: { name: 'timberjs-website' },
  }),
};
