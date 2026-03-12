import { defineConfig } from 'vite';
import type { Plugin, OutputChunk } from 'vite';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { timber } from '../../packages/timber-app/src/index';

const root = resolve(import.meta.dirname, '../..');

/**
 * Analyze client bundle composition for benchmarking.
 * Writes a JSON breakdown of each chunk's module sources so the benchmark
 * script can report react+dom vs timber framework vs app code sizes.
 */
function benchmarkAnalyze(): Plugin {
  return {
    name: 'benchmark-analyze',
    generateBundle(_options, bundle) {
      if ((this as any).environment?.name !== 'client') return;

      const analysis: Record<string, Record<string, number>> = {};

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const breakdown: Record<string, number> = {
          react: 0,
          timber: 0,
          app: 0,
          other: 0,
        };

        for (const [moduleId, info] of Object.entries(
          (chunk as OutputChunk).modules,
        )) {
          const size = info.renderedLength;
          if (
            moduleId.includes('node_modules/react-dom') ||
            moduleId.includes('node_modules/react/') ||
            moduleId.includes('node_modules/scheduler')
          ) {
            breakdown.react += size;
          } else if (
            moduleId.includes('/timber-app/') ||
            moduleId.includes('virtual:timber-') ||
            moduleId.includes('@vitejs/plugin-rsc') ||
            moduleId.includes('react-server-dom') ||
            moduleId.includes('virtual:vite-rsc/')
          ) {
            breakdown.timber += size;
          } else if (moduleId.includes('/fixture/app/')) {
            breakdown.app += size;
          } else {
            breakdown.other += size;
          }
        }

        analysis[fileName] = breakdown;
      }

      // Write analysis alongside the dist output
      writeFileSync(
        resolve(import.meta.dirname, 'dist/client-analysis.json'),
        JSON.stringify(analysis, null, 2),
      );
    },
  };
}

export default defineConfig({
  plugins: [timber(), benchmarkAnalyze()],
  root: import.meta.dirname,
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@timber/app/cache': resolve(root, 'packages/timber-app/src/cache/index.ts'),
      '@timber/app/server': resolve(root, 'packages/timber-app/src/server/index.ts'),
      '@timber/app/client': resolve(root, 'packages/timber-app/src/client/index.ts'),
      '@timber/app/content': resolve(root, 'packages/timber-app/src/content/index.ts'),
      '@timber/app/routing': resolve(root, 'packages/timber-app/src/routing/index.ts'),
      '@timber/app/search-params': resolve(root, 'packages/timber-app/src/search-params/index.ts'),
      '@timber/app': resolve(root, 'packages/timber-app/src/index.ts'),
    },
  },
});
