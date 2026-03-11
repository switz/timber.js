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
  const entryPath = opts.isDev
    ? '/@id/virtual:timber-browser-entry'
    : '/virtual:timber-browser-entry';
  scripts += `<script type="module" src="${entryPath}"></script>`;
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
        '<script type="module" src="/@id/virtual:timber-browser-entry"></script>'
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
      // Scripts still injected (dev mode uses /@id/ prefix)
      expect(result).toContain(
        '<script type="module" src="/@id/virtual:timber-browser-entry"></script>'
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

/**
 * Helper: run HTML through injectRscPayload and collect output.
 */
async function runInjectRscPayload(html: string, rscPayload: string | undefined): Promise<string> {
  const { injectRscPayload } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const htmlStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(html));
      controller.close();
    },
  });

  let rscStream: ReadableStream<Uint8Array> | undefined;
  if (rscPayload !== undefined) {
    rscStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(rscPayload));
        controller.close();
      },
    });
  }

  const outputStream = injectRscPayload(htmlStream, rscStream);
  const reader = outputStream.getReader();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value);
  }
  return result;
}

describe('injectRscPayload', () => {
  it('returns stream unchanged when rscStream is undefined', async () => {
    const html = '<html><body><div>Hello</div></body></html>';
    const result = await runInjectRscPayload(html, undefined);
    expect(result).toBe(html);
  });

  it('uses self.__timber_f=self.__timber_f||[]).push() pattern, not monolithic __TIMBER_RSC_PAYLOAD', async () => {
    const html = '<html><body><div>App</div></body></html>';
    const rscPayload = '0:D"$1"\n0:["$","div",null,{"children":"Hello"}]\n';
    const result = await runInjectRscPayload(html, rscPayload);

    // Should use progressive push() pattern
    expect(result).toContain('self.__timber_f=self.__timber_f||[]).push(');
    // Must NOT use the old monolithic payload format
    expect(result).not.toContain('__TIMBER_RSC_PAYLOAD');
    // Should be injected before </body>
    const pushIdx = result.indexOf('self.__timber_f=self.__timber_f||[]).push(');
    const bodyIdx = result.indexOf('</body>');
    expect(pushIdx).toBeLessThan(bodyIdx);
  });

  it('escapes < to prevent script injection', async () => {
    const html = '<html><body></body></html>';
    const rscPayload = '0:["$","div",null,{"children":"<script>alert(1)</script>"}]\n';
    const result = await runInjectRscPayload(html, rscPayload);

    // The literal < should be escaped so it doesn't break the <script> tag
    expect(result).not.toContain('<script>alert');
    // The payload should still be recoverable — escaped form
    expect(result).toContain('\\x3c');
  });

  it('escapes single quotes in the payload', async () => {
    const html = '<html><body></body></html>';
    const rscPayload = '0:["$","div",null,{"children":"it\'s a test"}]\n';
    const result = await runInjectRscPayload(html, rscPayload);

    // Single quotes must be escaped so they don't break the string literal
    expect(result).toContain("\\'");
  });

  it('escapes backslashes in the payload', async () => {
    const html = '<html><body></body></html>';
    const rscPayload = '0:["$","div",null,{"children":"path\\\\to\\\\file"}]\n';
    const result = await runInjectRscPayload(html, rscPayload);

    // Backslashes should be doubled
    expect(result).toContain('\\\\');
  });

  it('escapes newlines in the payload', async () => {
    const html = '<html><body></body></html>';
    // RSC flight format uses newlines as row delimiters
    const rscPayload = '0:D"$1"\n0:["$","div",null,{"children":"Hello"}]\n';
    const result = await runInjectRscPayload(html, rscPayload);

    // Literal newlines in a JS string literal are a syntax error —
    // they must be escaped as \n
    const scriptMatches = result.match(/<script>\(self\.__timber_f=self\.__timber_f\|\|\[\]\)\.push\((.*?)\)<\/script>/gs);
    expect(scriptMatches).not.toBeNull();
    // No push() call should contain literal newline characters in the string arg
    for (const m of scriptMatches!) {
      const inner = m.replace(/<\/?script>/g, '').replace(/^self\.__timber_f\.push\(/, '').replace(/\)$/, '');
      expect(inner).not.toMatch(/\n/);
    }
  });

  it('preserves the payload content after escaping', async () => {
    const html = '<html><body><div>App</div></body></html>';
    const rscPayload = '0:D"$1"\n0:["$","div",null,{"children":"Hello World"}]\n';
    const result = await runInjectRscPayload(html, rscPayload);

    // The original HTML content should still be present
    expect(result).toContain('<div>App</div>');
    // The payload text should be present (with escaping)
    expect(result).toContain('Hello World');
  });
});

describe('progressive RSC payload chunking', () => {
  /**
   * Helper: run HTML and RSC streams through injectRscPayload with
   * controlled timing, collecting output chunks separately.
   */
  async function runChunkedPayload(
    htmlChunks: { text: string; delayMs: number }[],
    rscChunks: { text: string; delayMs: number }[]
  ): Promise<string[]> {
    const { injectRscPayload } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const htmlStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of htmlChunks) {
          if (chunk.delayMs > 0) await new Promise((r) => setTimeout(r, chunk.delayMs));
          controller.enqueue(encoder.encode(chunk.text));
        }
        controller.close();
      },
    });

    const rscStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of rscChunks) {
          if (chunk.delayMs > 0) await new Promise((r) => setTimeout(r, chunk.delayMs));
          controller.enqueue(encoder.encode(chunk.text));
        }
        controller.close();
      },
    });

    const outputStream = injectRscPayload(htmlStream, rscStream);
    const outputChunks: string[] = [];
    const reader = outputStream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      outputChunks.push(decoder.decode(value));
    }
    return outputChunks;
  }

  it('injects RSC chunks as individual push() script tags, not one monolithic blob', async () => {
    const outputChunks = await runChunkedPayload(
      [
        { text: '<html><head></head><body><div>Shell</div>', delayMs: 0 },
        { text: '</body></html>', delayMs: 50 },
      ],
      [
        { text: '0:D"$1"\n', delayMs: 0 },
        { text: '0:["$","div",null,{"children":"Hello"}]\n', delayMs: 10 },
      ]
    );

    const fullOutput = outputChunks.join('');

    // Should use self.__timber_f=self.__timber_f||[]).push() pattern, not window.__TIMBER_RSC_PAYLOAD
    expect(fullOutput).toContain('self.__timber_f=self.__timber_f||[]).push(');
    expect(fullOutput).not.toContain('__TIMBER_RSC_PAYLOAD');

    // Each RSC chunk should be a separate push() call
    const pushCount = (fullOutput.match(/self\.__timber_f=self\.__timber_f\|\|\[\]\)\.push\(/g) || []).length;
    expect(pushCount).toBeGreaterThanOrEqual(2);
  });

  it('emits __timber_f_done exactly once, not twice', async () => {
    // When RSC stream finishes before </body> arrives, the done signal
    // should only be emitted once (with </body>), not again in flush().
    const outputChunks = await runChunkedPayload(
      [
        { text: '<html><head></head><body><div>Shell</div>', delayMs: 0 },
        { text: '</body></html>', delayMs: 50 },
      ],
      [
        // RSC finishes quickly — before </body> arrives
        { text: '0:D"$1"\n', delayMs: 0 },
      ]
    );

    const fullOutput = outputChunks.join('');
    const doneCount = (fullOutput.match(/self\.__timber_f_done=1/g) || []).length;
    expect(doneCount).toBe(1);
  });

  it('RSC chunks interleave with HTML — not all buffered at end', async () => {
    // Simulate streaming: RSC chunk 1 arrives before HTML chunk 2
    const outputChunks = await runChunkedPayload(
      [
        { text: '<html><head></head><body><div>Shell</div>', delayMs: 0 },
        // Suspense boundary resolves after 60ms
        { text: '<div>Resolved content</div>', delayMs: 60 },
        { text: '</body></html>', delayMs: 20 },
      ],
      [
        { text: '0:D"$1"\n', delayMs: 0 },
        // RSC chunk for resolved boundary arrives at ~30ms
        { text: '0:["$","div",null,{"children":"Resolved"}]\n', delayMs: 30 },
      ]
    );

    // The RSC push() scripts should appear in intermediate chunks,
    // not only in the final chunk that contains </body>.
    const nonLastChunks = outputChunks.slice(0, -1).join('');

    // At least one push() call should appear before the final chunk
    expect(nonLastChunks).toContain('self.__timber_f=self.__timber_f||[]).push(');
  });

  it('properly escapes RSC chunk content in push() calls', async () => {
    const outputChunks = await runChunkedPayload(
      [
        { text: '<html><body></body></html>', delayMs: 0 },
      ],
      [
        { text: '0:["$","div",null,{"children":"<script>alert(1)</script>"}]\n', delayMs: 0 },
      ]
    );

    const fullOutput = outputChunks.join('');

    // Must escape < to prevent script injection
    expect(fullOutput).not.toContain('<script>alert');
    expect(fullOutput).toContain('\\x3c');
    // Must use push() pattern
    expect(fullOutput).toContain('self.__timber_f=self.__timber_f||[]).push(');
  });
});

describe('buildClientScripts', () => {
  it('returns empty bootstrapScriptContent for static + noJS', async () => {
    const { buildClientScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
    const result = buildClientScripts({ output: 'static', noJS: true, dev: false });
    expect(result.bootstrapScriptContent).toBe('');
    expect(result.preloadLinks).toBe('');
  });

  it('uses dynamic import() in dev mode, not <script type="module">', async () => {
    const { buildClientScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
    const result = buildClientScripts({ output: 'server', noJS: false, dev: true });
    // Must use dynamic import() — not <script type="module"> which is deferred
    // and blocks hydration behind Suspense boundaries during streaming
    expect(result.bootstrapScriptContent).toContain('import("/@vite/client")');
    expect(result.bootstrapScriptContent).toContain('import("/@id/virtual:timber-browser-entry")');
    expect(result.bootstrapScriptContent).not.toContain('<script');
  });

  it('uses dynamic import() in production, not <script type="module">', async () => {
    const { buildClientScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
    const result = buildClientScripts({ output: 'server', noJS: false, dev: false });
    expect(result.bootstrapScriptContent).toContain('import(');
    expect(result.bootstrapScriptContent).toContain('virtual:timber-browser-entry');
    expect(result.bootstrapScriptContent).not.toContain('<script');
    expect(result.bootstrapScriptContent).not.toContain('/@vite/client');
  });

  it('includes scripts for static mode without noJS', async () => {
    const { buildClientScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
    const result = buildClientScripts({ output: 'static', noJS: false, dev: false });
    expect(result.bootstrapScriptContent).toContain('virtual:timber-browser-entry');
  });

  it('returns modulepreload links for production with build manifest', async () => {
    const { buildClientScripts } = await import(resolve(SRC_DIR, 'server/html-injectors.ts'));
    const result = buildClientScripts({
      output: 'server',
      noJS: false,
      dev: false,
      buildManifest: {
        js: { 'virtual:timber-browser-entry': '/assets/entry-abc123.js' },
        css: {},
        modulepreload: { 'virtual:timber-browser-entry': ['/assets/chunk-1.js', '/assets/chunk-2.js'] },
        fonts: {},
      },
    });
    expect(result.bootstrapScriptContent).toBe('import("/assets/entry-abc123.js")');
    expect(result.preloadLinks).toContain('<link rel="modulepreload" href="/assets/chunk-1.js">');
    expect(result.preloadLinks).toContain('<link rel="modulepreload" href="/assets/chunk-2.js">');
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
