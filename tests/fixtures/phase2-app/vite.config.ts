import { defineConfig } from 'vite';
import { timber } from '@timber/app';

export default defineConfig({
  plugins: [timber()],
  server: {
    port: 3000,
    strictPort: true,
  },
});
