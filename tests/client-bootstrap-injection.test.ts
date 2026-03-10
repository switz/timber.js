import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..', 'packages/timber-app/src');

/**
 * Helper: run an HTML string through injectScripts and collect the output.
 */
async function runInjectScripts(html: string, scripts: string): Promise<string> {
  const { injectScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const inputStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(html));
      controller.close();
    },
  });

  const outputStream = injectScripts(inputStream, scripts);
  const reader = outputStream.getReader();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value);
  }
  return result;
}

/**
 * Helper: run HTML through injectScripts with chunked input to test
 * the case where </body> spans chunk boundaries.
 */
async function runInjectScriptsChunked(chunks: string[], scripts: string): Promise<string> {
  const { injectScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const inputStream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  const outputStream = injectScripts(inputStream, scripts);
  const reader = outputStream.getReader();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value);
  }
  return result;
}

/**
 * Helper: build expected script tags the same way the rsc-entry does.
 */
function buildScriptTags(opts: { isDev: boolean }): string {
  let scripts = '';
  if (opts.isDev) {
    scripts += '<script type="module" src="/@vite/client"></script>';
  }
  scripts += '<script type="module" src="/virtual:timber-browser-entry"></script>';
  return scripts;
}

describe('client bootstrap script injection', () => {
  describe('script tag present', () => {
    it('injects browser entry script before </body>', async () => {
      const html = '<html><head><title>Test</title></head><body><div>Hello</div></body></html>';
      const scripts = buildScriptTags({ isDev: false });
      const result = await runInjectScripts(html, scripts);

      expect(result).toContain(
        '<script type="module" src="/virtual:timber-browser-entry"></script>'
      );
      expect(result).toContain(scripts + '</body>');
    });
  });

  describe('vite client in dev', () => {
    it('includes /@vite/client script in dev mode', async () => {
      const html = '<html><head></head><body><div>App</div></body></html>';
      const scripts = buildScriptTags({ isDev: true });
      const result = await runInjectScripts(html, scripts);

      expect(result).toContain('<script type="module" src="/@vite/client"></script>');
      expect(result).toContain(
        '<script type="module" src="/virtual:timber-browser-entry"></script>'
      );
    });

    it('does not include /@vite/client in production mode', async () => {
      const html = '<html><head></head><body><div>App</div></body></html>';
      const scripts = buildScriptTags({ isDev: false });
      const result = await runInjectScripts(html, scripts);

      expect(result).not.toContain('/@vite/client');
      expect(result).toContain(
        '<script type="module" src="/virtual:timber-browser-entry"></script>'
      );
    });
  });

  describe('script position', () => {
    it('places scripts before </body>, not in <head>', async () => {
      const html = '<html><head><title>Test</title></head><body><main>Content</main></body></html>';
      const scripts = buildScriptTags({ isDev: false });
      const result = await runInjectScripts(html, scripts);

      // Scripts should appear after body content, before </body>
      const bodyCloseIdx = result.indexOf('</body>');
      const scriptIdx = result.indexOf('<script type="module"');
      const headCloseIdx = result.indexOf('</head>');

      expect(scriptIdx).toBeGreaterThan(headCloseIdx);
      expect(scriptIdx).toBeLessThan(bodyCloseIdx);
    });
  });

  describe('noJS skips scripts', () => {
    it('produces no script tags when scripts string is empty', async () => {
      const html = '<html><head></head><body><div>Static</div></body></html>';
      // When output: static + noJS: true, no scripts string is passed
      const result = await runInjectScripts(html, '');

      expect(result).not.toContain('<script');
      expect(result).toBe(html);
    });
  });

  describe('metadata preserved', () => {
    it('injectScripts does not affect head content', async () => {
      const html =
        '<html><head><title>My Page</title><meta name="description" content="Test"></head><body><div>App</div></body></html>';
      const scripts = buildScriptTags({ isDev: true });
      const result = await runInjectScripts(html, scripts);

      // Head content preserved
      expect(result).toContain('<title>My Page</title>');
      expect(result).toContain('<meta name="description" content="Test">');
      // Scripts still injected
      expect(result).toContain(
        '<script type="module" src="/virtual:timber-browser-entry"></script>'
      );
    });
  });

  describe('edge cases', () => {
    it('handles </body> split across chunks', async () => {
      const scripts = buildScriptTags({ isDev: false });
      const result = await runInjectScriptsChunked(
        ['<html><head></head><body><div>Hi</div></bo', 'dy></html>'],
        scripts
      );

      expect(result).toContain(scripts + '</body>');
    });

    it('emits buffer when no </body> found', async () => {
      const html = '<div>Fragment without body close</div>';
      const scripts = buildScriptTags({ isDev: false });
      const result = await runInjectScripts(html, scripts);

      // Should still emit the content even without </body>
      expect(result).toContain('Fragment without body close');
    });
  });
});

describe('buildClientScripts', () => {
  it('returns empty string for static + noJS', async () => {
    const { buildClientScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
    const result = buildClientScripts({ output: 'static', noJS: true, dev: false });
    expect(result).toBe('');
  });

  it('includes vite client in dev mode', async () => {
    const { buildClientScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
    const result = buildClientScripts({ output: 'server', noJS: false, dev: true });
    expect(result).toContain('/@vite/client');
    expect(result).toContain('virtual:timber-browser-entry');
  });

  it('excludes vite client in production', async () => {
    const { buildClientScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
    const result = buildClientScripts({ output: 'server', noJS: false, dev: false });
    expect(result).not.toContain('/@vite/client');
    expect(result).toContain('virtual:timber-browser-entry');
  });

  it('includes scripts for static mode without noJS', async () => {
    const { buildClientScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
    const result = buildClientScripts({ output: 'static', noJS: false, dev: false });
    expect(result).toContain('virtual:timber-browser-entry');
  });
});

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
