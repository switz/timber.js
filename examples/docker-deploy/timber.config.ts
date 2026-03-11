import { nitro } from '@timber/app/adapters/nitro';

export default {
  output: 'server' as const,
  adapter: nitro({ preset: 'node-server' }),
};
