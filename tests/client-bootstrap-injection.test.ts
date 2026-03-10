import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..', 'packages/timber-app/src');

/**
 * Bootstrap script injection is now handled by React's renderToReadableStream
 * via the bootstrapScriptContent option, which is populated by the RSC plugin's
 * import.meta.viteRsc.loadBootstrapScriptContent('index').
 *
 * The noJS flag on NavContext controls whether bootstrap scripts are skipped
 * (for zero-JS static output). The config module must include the noJS flag
 * so the RSC entry can determine the correct value.
 */

describe('config module includes noJS', () => {
  it('generates config with noJS flag', async () => {
    const { timberEntries } = await import(resolve(SRC_DIR, 'plugins/entries.ts'));
    const ctx = {
      config: { output: 'static' as const, static: { noJS: true } },
      routeTree: null,
      appDir: '/tmp/app',
      root: '/tmp',
      dev: false,
    };
    const plugin = timberEntries(ctx);
    const load = plugin.load as (id: string) => string | null;
    const result = load.call({}, '\0virtual:timber-config');

    expect(result).toContain('"noJS": true');
    expect(result).toContain('"output": "static"');
  });

  it('defaults noJS to false', async () => {
    const { timberEntries } = await import(resolve(SRC_DIR, 'plugins/entries.ts'));
    const ctx = {
      config: { output: 'server' as const },
      routeTree: null,
      appDir: '/tmp/app',
      root: '/tmp',
      dev: false,
    };
    const plugin = timberEntries(ctx);
    const load = plugin.load as (id: string) => string | null;
    const result = load.call({}, '\0virtual:timber-config');

    expect(result).toContain('"noJS": false');
  });
});

describe('NavContext noJS flag', () => {
  it('SSR entry exports NavContext with noJS field', async () => {
    // Verify the NavContext type has noJS (compile-time check via import)
    // We can't instantiate the SSR entry (requires Vite RSC runtime),
    // but we verify the type definition is consistent.
    const ssrEntryPath = resolve(SRC_DIR, 'server/ssr-entry.ts');
    // The file should contain the noJS field declaration
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(ssrEntryPath, 'utf-8');
    expect(source).toContain('noJS: boolean');
    expect(source).not.toContain('scriptsHtml');
  });
});
