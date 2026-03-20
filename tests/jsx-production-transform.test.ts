/**
 * Tests that timber's pre-built dist/ files use production JSX transform.
 *
 * Timber's npm package is built via `vite build --config vite.lib.config.ts`.
 * The client entry (dist/client/index.js) and error boundary must use
 * jsx/jsxs from react/jsx-runtime — NOT jsxDEV from react/jsx-dev-runtime.
 *
 * If jsxDEV is present, the production bundle will crash at runtime because
 * the production React jsx-runtime doesn't export jsxDEV. File paths also
 * leak into the production bundle (security concern).
 *
 * Task: LOCAL-317
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../packages/timber-app/dist');

/**
 * Get all JS files in timber's dist that contain JSX calls.
 * These are the files that would be affected by dev vs prod JSX transform.
 */
function getDistJsFiles(): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (full.endsWith('.js') && !full.endsWith('.map')) {
        files.push(full);
      }
    }
  }
  if (existsSync(DIST_DIR)) walk(DIST_DIR);
  return files;
}

describe('timber dist: production JSX transform', () => {
  const jsFiles = getDistJsFiles();

  it('dist/ directory exists with JS files', () => {
    expect(jsFiles.length).toBeGreaterThan(0);
  });

  it('no dist file imports react/jsx-dev-runtime', () => {
    const violations: string[] = [];
    for (const file of jsFiles) {
      const content = readFileSync(file, 'utf-8');
      if (content.includes('jsx-dev-runtime')) {
        const relPath = file.replace(DIST_DIR + '/', '');
        violations.push(relPath);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no dist file contains jsxDEV calls', () => {
    const violations: string[] = [];
    for (const file of jsFiles) {
      const content = readFileSync(file, 'utf-8');
      // Match jsxDEV( but not in comments or string literals containing "jsxDEV"
      if (/\bjsxDEV\s*\(/.test(content)) {
        const relPath = file.replace(DIST_DIR + '/', '');
        violations.push(relPath);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no dist file leaks absolute file paths via JSX debug info', () => {
    // Dev JSX transform embeds {fileName: "/absolute/path/to/file.tsx", lineNumber: N}
    // in every JSX call. These must not appear in dist/.
    const violations: string[] = [];
    for (const file of jsFiles) {
      const content = readFileSync(file, 'utf-8');
      if (/fileName:\s*["']\//.test(content)) {
        const relPath = file.replace(DIST_DIR + '/', '');
        violations.push(relPath);
      }
    }
    expect(violations).toEqual([]);
  });

  it('client/index.js uses production jsx from react/jsx-runtime', () => {
    const clientIndex = resolve(DIST_DIR, 'client/index.js');
    if (!existsSync(clientIndex)) return; // skip if not built
    const content = readFileSync(clientIndex, 'utf-8');
    expect(content).toContain('react/jsx-runtime');
    expect(content).not.toContain('react/jsx-dev-runtime');
  });
});

describe('timber-root-sync: production JSX config', () => {
  // Test that the rootSync plugin returns oxc.jsx.development: false for builds
  it('timber() plugin array includes root-sync that forces prod JSX on build', async () => {
    // Import the timber function and extract the root-sync plugin
    const { timber } = await import('../packages/timber-app/src/index');
    const plugins = timber();

    // Find the root-sync plugin (it's a direct Plugin, not a promise)
    const rootSync = (plugins as any[]).find(
      (p: any) => p && typeof p === 'object' && p.name === 'timber-root-sync'
    );
    expect(rootSync).toBeDefined();

    // Call the config hook as Vite would during a build
    const configHook = rootSync.config;
    expect(configHook).toBeDefined();

    const result = await configHook({ root: process.cwd() }, { command: 'build', mode: 'production' });
    expect(result).toBeDefined();
    expect(result.oxc.jsx.development).toBe(false);
  });

  it('timber() root-sync does not force JSX mode in dev', async () => {
    const { timber } = await import('../packages/timber-app/src/index');
    const plugins = timber();

    const rootSync = (plugins as any[]).find(
      (p: any) => p && typeof p === 'object' && p.name === 'timber-root-sync'
    );

    const result = await rootSync.config({ root: process.cwd() }, { command: 'serve', mode: 'development' });
    // In dev mode, the hook should not return oxc config (let Vite decide)
    expect(result?.oxc?.jsx?.development).toBeUndefined();
  });
});
