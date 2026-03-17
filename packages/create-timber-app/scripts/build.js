// Build create-timber-app CLI using Vite (Rolldown)
import { build } from 'vite';

await build({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    outDir: 'dist',
    rollupOptions: {
      external: ['prompts', /^node:/],
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
    target: 'node20',
    minify: false,
  },
  logLevel: 'warn',
});
