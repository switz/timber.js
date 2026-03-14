/**
 * Tests for 103 Early Hints API.
 *
 * Covers:
 * - ctx.earlyHints() API available in middleware and route handlers
 * - Link headers correctly formatted for preload/preconnect
 * - Auto-discovered CSS/font assets emitted as early hints
 * - Early hints do not block the final response
 *
 * Design docs: 02-rendering-pipeline.md §"Early Hints", 07-routing.md §"middleware.ts"
 */

import { describe, it, expect } from 'vitest';
import {
  collectEarlyHintHeaders,
  formatLinkHeader,
  type EarlyHint,
} from '../packages/timber-app/src/server/early-hints';
import {
  createPipeline,
  type PipelineConfig,
  type RouteMatch,
} from '../packages/timber-app/src/server/pipeline';
import type { BuildManifest } from '../packages/timber-app/src/server/build-manifest';
import type { MiddlewareContext } from '../packages/timber-app/src/server/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

function makeMatch(overrides?: Partial<RouteMatch>): RouteMatch {
  return { segments: [], params: {}, ...overrides };
}

function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    matchRoute: () => makeMatch(),
    render: (_req, _match, responseHeaders) =>
      new Response('OK', { status: 200, headers: responseHeaders }),
    ...overrides,
  };
}

// ─── formatLinkHeader ─────────────────────────────────────────────────────

describe('formats Link headers correctly', () => {
  it('formats a preload style hint', () => {
    const hint: EarlyHint = { href: '/styles/root.css', rel: 'preload', as: 'style' };
    expect(formatLinkHeader(hint)).toBe('</styles/root.css>; rel=preload; as=style');
  });

  it('formats a preload font hint with crossorigin', () => {
    const hint: EarlyHint = {
      href: '/fonts/inter.woff2',
      rel: 'preload',
      as: 'font',
      crossOrigin: 'anonymous',
    };
    expect(formatLinkHeader(hint)).toBe(
      '</fonts/inter.woff2>; rel=preload; as=font; crossorigin=anonymous'
    );
  });

  it('formats a modulepreload hint (no as)', () => {
    const hint: EarlyHint = { href: '/_timber/client.js', rel: 'modulepreload' };
    expect(formatLinkHeader(hint)).toBe('</_timber/client.js>; rel=modulepreload');
  });

  it('formats a preconnect hint (no as)', () => {
    const hint: EarlyHint = { href: 'https://fonts.googleapis.com', rel: 'preconnect' };
    expect(formatLinkHeader(hint)).toBe('<https://fonts.googleapis.com>; rel=preconnect');
  });

  it('formats a preload image hint with fetchpriority', () => {
    const hint: EarlyHint = {
      href: '/images/hero.webp',
      rel: 'preload',
      as: 'image',
      fetchPriority: 'low',
    };
    expect(formatLinkHeader(hint)).toBe(
      '</images/hero.webp>; rel=preload; as=image; fetchpriority=low'
    );
  });

  it('omits as when undefined', () => {
    const hint: EarlyHint = { href: '/resource', rel: 'preload' };
    expect(formatLinkHeader(hint)).toBe('</resource>; rel=preload');
  });
});

// ─── collectEarlyHintHeaders ──────────────────────────────────────────────

describe('auto-discovers critical assets', () => {
  const manifest: BuildManifest = {
    css: {
      'app/layout.tsx': ['/_timber/assets/root-abc.css'],
      'app/dashboard/layout.tsx': ['/_timber/assets/dashboard-def.css'],
      'app/dashboard/page.tsx': ['/_timber/assets/page-ghi.css'],
    },
    js: {
      'app/layout.tsx': '/_timber/assets/root-abc.js',
    },
    modulepreload: {
      'app/layout.tsx': ['/_timber/assets/dep-xyz.js'],
    },
    fonts: {
      'app/layout.tsx': [
        {
          href: '/_timber/fonts/inter-latin-400-normal.woff2',
          format: 'woff2',
          crossOrigin: 'anonymous',
        },
      ],
    },
  };

  it('collects CSS preload hints for matched segments', () => {
    const segments = [
      { layout: { filePath: 'app/layout.tsx' } },
      {
        layout: { filePath: 'app/dashboard/layout.tsx' },
        page: { filePath: 'app/dashboard/page.tsx' },
      },
    ];

    const headers = collectEarlyHintHeaders(segments, manifest);
    expect(headers).toContain('</_timber/assets/root-abc.css>; rel=preload; as=style');
    expect(headers).toContain('</_timber/assets/dashboard-def.css>; rel=preload; as=style');
    expect(headers).toContain('</_timber/assets/page-ghi.css>; rel=preload; as=style');
  });

  it('collects font preload hints for matched segments', () => {
    const segments = [{ layout: { filePath: 'app/layout.tsx' } }];

    const headers = collectEarlyHintHeaders(segments, manifest);
    expect(headers).toContain(
      '</_timber/fonts/inter-latin-400-normal.woff2>; rel=preload; as=font; crossorigin=anonymous'
    );
  });

  it('collects modulepreload hints for JS dependencies', () => {
    const segments = [{ layout: { filePath: 'app/layout.tsx' } }];

    const headers = collectEarlyHintHeaders(segments, manifest);
    expect(headers).toContain('</_timber/assets/dep-xyz.js>; rel=modulepreload');
  });

  it('returns empty array when no manifest entries match segments', () => {
    const segments = [{ layout: { filePath: 'app/unknown/layout.tsx' } }];

    const headers = collectEarlyHintHeaders(segments, manifest);
    expect(headers).toHaveLength(0);
  });

  it('only collects hints from matched segments, not all manifest entries', () => {
    const segments = [{ layout: { filePath: 'app/layout.tsx' } }];

    const headers = collectEarlyHintHeaders(segments, manifest);
    expect(headers.some((h) => h.includes('page-ghi'))).toBe(false);
    expect(headers.some((h) => h.includes('dashboard-def'))).toBe(false);
  });

  it('collects global CSS from _global manifest key', () => {
    const globalManifest: BuildManifest = {
      css: {
        _global: ['/_timber/assets/layout-abc.css', '/_timber/assets/page-def.css'],
      },
      js: {},
      modulepreload: {},
      fonts: {},
    };
    const segments = [{ layout: { filePath: 'app/layout.tsx' } }];

    const headers = collectEarlyHintHeaders(segments, globalManifest);
    expect(headers).toContain('</_timber/assets/layout-abc.css>; rel=preload; as=style');
    expect(headers).toContain('</_timber/assets/page-def.css>; rel=preload; as=style');
  });

  it('deduplicates per-route CSS with global CSS', () => {
    const mixedManifest: BuildManifest = {
      css: {
        'app/layout.tsx': ['/_timber/assets/shared.css'],
        '_global': ['/_timber/assets/shared.css', '/_timber/assets/other.css'],
      },
      js: {},
      modulepreload: {},
      fonts: {},
    };
    const segments = [{ layout: { filePath: 'app/layout.tsx' } }];

    const headers = collectEarlyHintHeaders(segments, mixedManifest);
    const sharedCount = headers.filter((h) => h.includes('shared.css')).length;
    expect(sharedCount).toBe(1);
    expect(headers).toContain('</_timber/assets/other.css>; rel=preload; as=style');
  });

  it('skips JS modulepreload hints when skipJs is set', () => {
    const segments = [{ layout: { filePath: 'app/layout.tsx' } }];

    const headers = collectEarlyHintHeaders(segments, manifest, { skipJs: true });
    expect(headers.some((h) => h.includes('modulepreload'))).toBe(false);
    // CSS and fonts are still included
    expect(headers).toContain('</_timber/assets/root-abc.css>; rel=preload; as=style');
    expect(headers).toContain(
      '</_timber/fonts/inter-latin-400-normal.woff2>; rel=preload; as=font; crossorigin=anonymous'
    );
  });

  it('deduplicates hints across segments', () => {
    const sharedManifest: BuildManifest = {
      css: {
        'app/layout.tsx': ['/_timber/assets/shared.css'],
        'app/page.tsx': ['/_timber/assets/shared.css'],
      },
      js: {},
      modulepreload: {},
      fonts: {},
    };
    const segments = [
      { layout: { filePath: 'app/layout.tsx' }, page: { filePath: 'app/page.tsx' } },
    ];

    const headers = collectEarlyHintHeaders(segments, sharedManifest);
    const count = headers.filter((h) => h.includes('shared.css')).length;
    expect(count).toBe(1);
  });
});

// ─── sends 103 early hints from middleware ────────────────────────────────

describe('sends 103 early hints from middleware', () => {
  it('ctx.earlyHints() is callable from middleware and adds Link header', async () => {
    let capturedCtx: MiddlewareContext | undefined;

    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async (ctx: MiddlewareContext) => {
              capturedCtx = ctx;
              ctx.earlyHints([{ href: '/styles/critical.css', rel: 'preload', as: 'style' }]);
            },
          }),
      })
    );

    const response = await handler(makeRequest('/test'));
    expect(capturedCtx).toBeDefined();
    const linkHeader = response.headers.get('Link');
    expect(linkHeader).toContain('</styles/critical.css>; rel=preload; as=style');
  });

  it('multiple earlyHints() calls accumulate in Link header', async () => {
    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async (ctx: MiddlewareContext) => {
              ctx.earlyHints([{ href: '/styles/root.css', rel: 'preload', as: 'style' }]);
              ctx.earlyHints([
                {
                  href: '/fonts/inter.woff2',
                  rel: 'preload',
                  as: 'font',
                  crossOrigin: 'anonymous',
                },
              ]);
            },
          }),
      })
    );

    const response = await handler(makeRequest('/'));
    const linkHeader = response.headers.get('Link');
    expect(linkHeader).toContain('</styles/root.css>; rel=preload; as=style');
    expect(linkHeader).toContain('</fonts/inter.woff2>; rel=preload; as=font');
  });

  it('preconnect hint has no as attribute', async () => {
    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async (ctx: MiddlewareContext) => {
              ctx.earlyHints([{ href: 'https://fonts.googleapis.com', rel: 'preconnect' }]);
            },
          }),
      })
    );

    const response = await handler(makeRequest('/'));
    const linkHeader = response.headers.get('Link');
    expect(linkHeader).toContain('<https://fonts.googleapis.com>; rel=preconnect');
    expect(linkHeader).not.toContain('as=');
  });
});

// ─── early hints do not block response ───────────────────────────────────

describe('early hints do not block response', () => {
  it('earlyHints() in middleware does not block the response', async () => {
    let middlewareResolved = false;

    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async (ctx: MiddlewareContext) => {
              ctx.earlyHints([{ href: '/styles/app.css', rel: 'preload', as: 'style' }]);
              middlewareResolved = true;
            },
          }),
      })
    );

    const response = await handler(makeRequest('/'));
    expect(middlewareResolved).toBe(true);
    expect(response.status).toBe(200);
  });

  it('pipeline earlyHints emitter fires before middleware', async () => {
    const order: string[] = [];

    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async () => {
              order.push('middleware');
            },
          }),
        earlyHints: (_match, _req, responseHeaders) => {
          responseHeaders.append('Link', '</_timber/assets/root.css>; rel=preload; as=style');
          order.push('early-hints');
        },
        render: () => {
          order.push('render');
          return new Response('OK');
        },
      })
    );

    await handler(makeRequest('/'));
    expect(order).toEqual(['early-hints', 'middleware', 'render']);
  });

  it('earlyHints emitter failure is non-fatal', async () => {
    const handler = createPipeline(
      makeConfig({
        earlyHints: () => {
          throw new Error('hints emitter failed');
        },
        render: () => new Response('OK', { status: 200 }),
      })
    );

    const response = await handler(makeRequest('/'));
    expect(response.status).toBe(200);
  });

  it('async earlyHints emitter runs before middleware', async () => {
    let earlyHintsDone = false;

    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async () => {
              // earlyHints must have completed before middleware runs
              expect(earlyHintsDone).toBe(true);
            },
          }),
        earlyHints: async () => {
          await Promise.resolve();
          earlyHintsDone = true;
        },
      })
    );

    await handler(makeRequest('/'));
    expect(earlyHintsDone).toBe(true);
  });
});
