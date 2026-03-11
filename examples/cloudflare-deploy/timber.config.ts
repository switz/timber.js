import { cloudflare } from '@timber/app/adapters/cloudflare';

export default {
  output: 'server' as const,
  adapter: cloudflare(),
};
