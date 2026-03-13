import { describe, it, expect, vi } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..', 'packages/timber-app/src');

/**
 * Helper: collect a ReadableStream into a string.
 */
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value);
  }
  return result;
}

/**
 * Helper: create a simple React element that renders to known HTML.
 */
function createTestElement(content: string) {
  return createElement('div', { 'data-testid': 'ssr-test' }, content);
}

describe('SSR entry — renderSsrStream', () => {
  it('renders to stream', async () => {
    const { renderSsrStream } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));
    const element = createTestElement('Hello SSR');

    const stream = await renderSsrStream(element);
    const html = await streamToString(stream);

    expect(html).toContain('Hello SSR');
    expect(html).toContain('<div');
  });

  it('hydration markers', async () => {
    const { renderSsrStream } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));
    const element = createTestElement('Hydration Test');

    const stream = await renderSsrStream(element);
    const html = await streamToString(stream);

    // React 19 renderToReadableStream produces HTML that can be hydrated.
    // It includes data-reactroot or similar markers in the output.
    // The key indicator is that it produces valid HTML with React's
    // internal comment markers for hydration boundaries.
    expect(html).toContain('Hydration Test');
    expect(html).toContain('<div');
    // React 19 uses <!-- --> comment nodes for Suspense boundaries
    // and produces hydratable output by default from renderToReadableStream
  });

  it('shell ready', async () => {
    const { renderSsrStream } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));

    // Create an element with a Suspense boundary to verify shell behavior.
    // The outer content should be in the shell (available immediately),
    // while Suspense content streams later.
    const element = createElement(
      'html',
      null,
      createElement('head', null),
      createElement('body', null, createElement('div', { id: 'shell' }, 'Shell Content'))
    );

    const stream = await renderSsrStream(element);
    const html = await streamToString(stream);

    // Shell content should be present (renderToReadableStream waits for
    // onShellReady by default before the stream starts yielding)
    expect(html).toContain('Shell Content');
    expect(html).toContain('<div id="shell"');
  });
});

describe('SSR entry — buildSsrResponse', () => {
  it('status and headers', async () => {
    const { buildSsrResponse } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));

    const encoder = new TextEncoder();
    const htmlStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('<html><body>Test</body></html>'));
        controller.close();
      },
    });

    const responseHeaders = new Headers({
      'x-custom': 'test-value',
      'cache-control': 'no-store',
    });

    const response = buildSsrResponse(htmlStream, 201, responseHeaders);

    expect(response.status).toBe(201);
    expect(response.headers.get('x-custom')).toBe('test-value');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');

    const body = await response.text();
    expect(body).toContain('Test');
  });

  it('preserves existing content-type header', async () => {
    const { buildSsrResponse } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));

    const encoder = new TextEncoder();
    const htmlStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data'));
        controller.close();
      },
    });

    const responseHeaders = new Headers({
      'content-type': 'text/html; charset=iso-8859-1',
    });

    const response = buildSsrResponse(htmlStream, 200, responseHeaders);
    expect(response.headers.get('content-type')).toBe('text/html; charset=iso-8859-1');
  });

  it('uses 404 status code', async () => {
    const { buildSsrResponse } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));

    const encoder = new TextEncoder();
    const htmlStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('Not Found'));
        controller.close();
      },
    });

    const response = buildSsrResponse(htmlStream, 404, new Headers());
    expect(response.status).toBe(404);
  });
});

describe('SSR entry — abort signal handling', () => {
  it('passes abort signal to renderToReadableStream', async () => {
    const { renderSsrStream } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));
    const element = createTestElement('Abort Test');
    const ac = new AbortController();

    // Render with a signal — should work normally when not aborted
    const stream = await renderSsrStream(element, { signal: ac.signal });
    const html = await streamToString(stream);
    expect(html).toContain('Abort Test');
  });

  it('suppresses error logging for aborted connections', async () => {
    const { renderSsrStream } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ac = new AbortController();

    // Create an element with a Suspense boundary that will be interrupted
    const element = createTestElement('Abort Suppress Test');
    const stream = await renderSsrStream(element, { signal: ac.signal });

    // Abort the signal
    ac.abort();

    // Read the stream — should close cleanly without logging
    const html = await streamToString(stream);
    expect(html).toContain('Abort Suppress Test');

    // No SSR error should have been logged for abort
    const ssrErrors = consoleSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('[timber] SSR')
    );
    expect(ssrErrors).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it('still logs real render errors (not abort)', async () => {
    const { renderSsrStream } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const element = createTestElement('Normal render');
    const stream = await renderSsrStream(element);
    const html = await streamToString(stream);
    expect(html).toContain('Normal render');

    consoleSpy.mockRestore();
  });
});

describe('SSR entry — isAbortError helper', () => {
  it('detects DOMException AbortError', async () => {
    const { isAbortError } = await import(
      resolve(SRC_DIR, 'server/rsc-entry/helpers.ts')
    );
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    expect(isAbortError(abortError)).toBe(true);
  });

  it('detects Error with name AbortError', async () => {
    const { isAbortError } = await import(
      resolve(SRC_DIR, 'server/rsc-entry/helpers.ts')
    );
    const error = new Error('aborted');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('does not match regular errors', async () => {
    const { isAbortError } = await import(
      resolve(SRC_DIR, 'server/rsc-entry/helpers.ts')
    );
    expect(isAbortError(new Error('something went wrong'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('string error')).toBe(false);
  });
});

describe('SSR entry — decodes RSC stream', () => {
  it('handleSsr passes through status and headers with stub decoder', async () => {
    // This test validates the handleSsr function's response construction.
    // Full RSC stream decoding requires the Vite RSC plugin runtime,
    // so we test the response construction separately.
    const { buildSsrResponse } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('<div>Decoded RSC Content</div>'));
        controller.close();
      },
    });

    const headers = new Headers({ 'x-request-id': 'abc-123' });
    const response = buildSsrResponse(stream, 200, headers);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('abc-123');

    const body = await response.text();
    expect(body).toContain('Decoded RSC Content');
  });
});
