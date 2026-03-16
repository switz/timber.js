import { defineConfig } from 'vite';
import { timber } from '@timber-js/app';

export default defineConfig({
  plugins: [timber()],
});
