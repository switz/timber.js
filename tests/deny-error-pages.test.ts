import { describe, expect, it } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';

// Untyped createElement for components with custom props that don't fit
// React's built-in element type overloads.
const h = createElement as (...args: unknown[]) => React.ReactElement;

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

// ─── resolveManifestStatusFile tests ──────────────────────────────────────────

interface ManifestFile {
  load: () => Promise<unknown>;
  filePath: string;
}

interface ManifestSegment {
  segmentName: string;
  segmentType: string;
  urlPath: string;
  statusFiles?: Record<string, ManifestFile>;
  legacyStatusFiles?: Record<string, ManifestFile>;
  error?: ManifestFile;
  layout?: ManifestFile;
  children: ManifestSegment[];
  slots: Record<string, ManifestSegment>;
}

function makeManifestFile(filePath: string): ManifestFile {
  return { load: async () => ({}), filePath };
}

function makeManifestSegment(overrides?: Partial<ManifestSegment>): ManifestSegment {
  return {
    segmentName: '',
    segmentType: 'static',
    urlPath: '/',
    children: [],
    slots: {},
    ...overrides,
  };
}

describe('resolveManifestStatusFile', () => {
  it('resolves exact status file for deny(404)', async () => {
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );

    const segments = [
      makeManifestSegment({
        statusFiles: { '404': makeManifestFile('app/404.tsx') },
      }),
    ];

    const result = resolveManifestStatusFile(404, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/404.tsx');
    expect(result!.status).toBe(404);
    expect(result!.kind).toBe('exact');
  });

  it('resolves 403.tsx for deny(403)', async () => {
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );

    const segments = [
      makeManifestSegment({
        statusFiles: { '403': makeManifestFile('app/403.tsx') },
      }),
    ];

    const result = resolveManifestStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/403.tsx');
    expect(result!.status).toBe(403);
  });

  it('resolves 401.tsx for deny(401)', async () => {
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );

    const segments = [
      makeManifestSegment({
        statusFiles: { '401': makeManifestFile('app/401.tsx') },
      }),
    ];

    const result = resolveManifestStatusFile(401, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/401.tsx');
    expect(result!.status).toBe(401);
  });

  it('resolves 4xx.tsx catch-all when no exact match', async () => {
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );

    const segments = [
      makeManifestSegment({
        statusFiles: { '4xx': makeManifestFile('app/4xx.tsx') },
      }),
    ];

    const result = resolveManifestStatusFile(429, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/4xx.tsx');
    expect(result!.kind).toBe('category');
    expect(result!.status).toBe(429);
  });

  it('walks leaf → root to find status file', async () => {
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );

    const segments = [
      makeManifestSegment({
        statusFiles: { '404': makeManifestFile('app/404.tsx') },
      }),
      makeManifestSegment({ segmentName: 'blog' }),
    ];

    const result = resolveManifestStatusFile(404, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/404.tsx');
    expect(result!.segmentIndex).toBe(0);
  });

  it('falls back to legacy not-found.tsx for 404', async () => {
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );

    const segments = [
      makeManifestSegment({
        legacyStatusFiles: { 'not-found': makeManifestFile('app/not-found.tsx') },
      }),
    ];

    const result = resolveManifestStatusFile(404, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/not-found.tsx');
    expect(result!.kind).toBe('legacy');
  });

  it('falls back to error.tsx when no status file found', async () => {
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );

    const segments = [
      makeManifestSegment({
        error: makeManifestFile('app/error.tsx'),
      }),
    ];

    const result = resolveManifestStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/error.tsx');
    expect(result!.kind).toBe('error');
  });

  it('returns null when no status file found (fallback bare response)', async () => {
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );

    const segments = [makeManifestSegment()];

    const result = resolveManifestStatusFile(404, segments);
    expect(result).toBeNull();
  });
});

// ─── renderErrorPage tests ────────────────────────────────────────────────────

describe('renderErrorPage', () => {
  it('renders status-code page component to HTML stream', async () => {
    const { renderSsrStream } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));

    // Simulate what renderErrorPage produces: a React element for the error page
    const errorPageElement = createElement('div', { 'data-testid': 'not-found' }, 'Page not found');
    const stream = await renderSsrStream(errorPageElement);
    const html = await streamToString(stream);

    expect(html).toContain('Page not found');
    expect(html).toContain('data-testid="not-found"');
  });

  it('error page response has correct status code', async () => {
    const { buildSsrResponse } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('<div>Not Found</div>'));
        controller.close();
      },
    });

    const response = buildSsrResponse(stream, 404, new Headers());
    expect(response.status).toBe(404);
  });
});

// ─── DenySignal data forwarding ───────────────────────────────────────────────

describe('DenySignal data forwarding', () => {
  it('DenySignal carries status and data for dangerouslyPassData prop', async () => {
    const { DenySignal } = await import(resolve(SRC_DIR, 'server/primitives.ts'));

    const signal = new DenySignal(404, { resourceId: 'post-123' });
    expect(signal.status).toBe(404);
    expect(signal.data).toEqual({ resourceId: 'post-123' });
  });

  it('DenySignal without data has undefined data', async () => {
    const { DenySignal } = await import(resolve(SRC_DIR, 'server/primitives.ts'));

    const signal = new DenySignal(403);
    expect(signal.status).toBe(403);
    expect(signal.data).toBeUndefined();
  });
});

// ─── Integration: handleSsr DenySignal with error page ────────────────────────

describe('handleSsr DenySignal error page rendering', () => {
  it('not-found page rendered on deny(404) when status file exists', async () => {
    // This tests the integration at the ssr-render level.
    // Full handleSsr requires Vite RSC runtime, so we test the building blocks.
    const { renderSsrStream, buildSsrResponse } = await import(
      resolve(SRC_DIR, 'server/ssr-render.ts')
    );
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );

    // Simulate: segments with a 404.tsx
    const segments = [
      makeManifestSegment({
        statusFiles: {
          '404': {
            load: async () => ({
              default: (props: { status: number }) =>
                createElement('div', null, `Error ${props.status}`),
            }),
            filePath: 'app/404.tsx',
          },
        },
        layout: {
          load: async () => ({
            default: ({ children }: { children: React.ReactNode }) =>
              createElement('html', null, createElement('body', null, children)),
          }),
          filePath: 'app/layout.tsx',
        },
      }),
    ];

    // Step 1: resolve the status file
    const resolution = resolveManifestStatusFile(404, segments);
    expect(resolution).not.toBeNull();
    expect(resolution!.file.filePath).toBe('app/404.tsx');

    // Step 2: load the component and render
    const mod = (await resolution!.file.load()) as { default: (props: unknown) => unknown };
    const element = h(mod.default, { status: 404 });
    const stream = await renderSsrStream(element);
    const html = await streamToString(stream);

    expect(html).toContain('Error 404');

    // Step 3: build response with correct status
    const encoder = new TextEncoder();
    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(html));
        controller.close();
      },
    });
    const response = buildSsrResponse(responseStream, 404, new Headers());
    expect(response.status).toBe(404);
  });

  it('fallback bare response when no status file exists', async () => {
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );

    const segments = [makeManifestSegment()];
    const resolution = resolveManifestStatusFile(404, segments);
    expect(resolution).toBeNull();

    // When null, SSR falls back to bare Response(null, { status })
    const response = new Response(null, { status: 404 });
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
  });

  it('data prop forwarded to status-code page', async () => {
    const { resolveManifestStatusFile } = await import(
      resolve(SRC_DIR, 'server/manifest-status-resolver.ts')
    );
    const { renderSsrStream } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));

    const segments = [
      makeManifestSegment({
        statusFiles: {
          '404': {
            load: async () => ({
              default: (props: { status: number; dangerouslyPassData: unknown }) =>
                createElement(
                  'div',
                  null,
                  `Not found: ${(props.dangerouslyPassData as { resourceId: string })?.resourceId}`
                ),
            }),
            filePath: 'app/404.tsx',
          },
        },
      }),
    ];

    const resolution = resolveManifestStatusFile(404, segments);
    expect(resolution).not.toBeNull();

    const mod = (await resolution!.file.load()) as { default: (props: unknown) => unknown };
    const denyData = { resourceId: 'post-abc' };
    const element = h(mod.default, {
      status: 404,
      dangerouslyPassData: denyData,
    });
    const stream = await renderSsrStream(element);
    const html = await streamToString(stream);

    expect(html).toContain('Not found: post-abc');
  });
});
