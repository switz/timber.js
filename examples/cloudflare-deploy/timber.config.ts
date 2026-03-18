import { cloudflare } from '@timber-js/app/adapters/cloudflare';

export default {
  output: 'server' as const,
  adapter: cloudflare(),
};
