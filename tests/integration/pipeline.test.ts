/**
 * Phase 1 Integration Tests — Pipeline
 *
 * Tests the full request pipeline end-to-end:
 *   proxy.ts → canonicalize → route match → middleware.ts → render
 *
 * Each test exercises observable HTTP behavior — status codes, headers, bodies.
 * No implementation details are tested; only the contract between HTTP request and response.
 *
 * Ported from acceptance criteria in timber-dch.15.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createPipeline,
  type PipelineConfig,
  type RouteMatch,
  type RouteRenderer,
} from '../../packages/timber-app/src/server/pipeline';
import {
  deny,
  redirect,
  RenderError,
  DenySignal,
  RedirectSignal,
} from '../../packages/timber-app/src/server/primitives';
import {
  resolveMetadata,
  renderMetadataToElements,
  type SegmentMetadataEntry,
} from '../../packages/timber-app/src/server/metadata';
import type { SegmentNode, RouteFile } from '../../packages/timber-app/src/routing/types';
import { resolveStatusFile } from '../../packages/timber-app/src/server/status-code-resolver';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

function makeMatch(overrides?: Partial<RouteMatch>): RouteMatch {
  return {
    segments: [],
    params: {},
    ...overrides,
  };
}

function okRender(body = 'OK', status = 200): RouteRenderer {
  return (_req, _match, responseHeaders) => {
    const res = new Response(body, { status });
    responseHeaders.forEach((v, k) => res.headers.set(k, v));
    return res;
  };
}

function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    matchRoute: () => makeMatch(),
    render: okRender(),
    ...overrides,
  };
}

function makeRouteFile(filePath: string): RouteFile {
  return { filePath, extension: 'tsx' };
}

function makeSegment(overrides?: Partial<SegmentNode>): SegmentNode {
  return {
    segmentName: '',
    segmentType: 'static',
    urlPath: '/',
    children: [],
    slots: new Map(),
    ...overrides,
  };
}

// ─── 200 Page Route ──────────────────────────────────────────────────────

describe('200 page route', () => {
  it('returns HTTP 200 for a valid page route through the full pipeline', async () => {
    const handler = createPipeline({
      proxy: async (_req, next) => next(),
      matchRoute: (pathname) => {
        if (pathname === '/dashboard') {
          return makeMatch({
            segments: [
              makeSegment({ segmentName: '', urlPath: '/' }),
              makeSegment({ segmentName: 'dashboard', urlPath: '/dashboard' }),
            ],
            params: {},
          });
        }
        return null;
      },
      render: okRender('<html>Dashboard</html>'),
    });

    const res = await handler(makeRequest('/dashboard'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>Dashboard</html>');
  });

  it('full pipeline order: proxy → match → middleware → render → 200', async () => {
    const order: string[] = [];

    const handler = createPipeline({
      proxy: async (_req, next) => {
        order.push('proxy');
        return next();
      },
      matchRoute: () => {
        order.push('match');
        return makeMatch({
          middleware: async () => {
            order.push('middleware');
          },
        });
      },
      render: () => {
        order.push('render');
        return new Response('OK', { status: 200 });
      },
    });

    const res = await handler(makeRequest('/page'));
    expect(res.status).toBe(200);
    expect(order).toEqual(['proxy', 'match', 'middleware', 'render']);
  });
});

// ─── 302 Redirect ────────────────────────────────────────────────────────

describe('302 redirect', () => {
  it('middleware returning a redirect response produces HTTP 302', async () => {
    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async () => {
              return new Response(null, {
                status: 302,
                headers: { Location: '/login' },
              });
            },
          }),
      })
    );

    const res = await handler(makeRequest('/protected'));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('redirect() primitive throws RedirectSignal with 302 and relative path', () => {
    try {
      redirect('/login');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RedirectSignal);
      expect((e as RedirectSignal).status).toBe(302);
      expect((e as RedirectSignal).location).toBe('/login');
    }
  });

  it('render returning 302 propagates through proxy wrapper', async () => {
    const handler = createPipeline({
      proxy: async (_req, next) => {
        const res = await next();
        return res;
      },
      matchRoute: () => makeMatch(),
      render: () => new Response(null, { status: 302, headers: { Location: '/home' } }),
    });

    const res = await handler(makeRequest('/old-page'));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/home');
  });
});

// ─── 4xx Deny ────────────────────────────────────────────────────────────

describe('4xx deny', () => {
  it('deny() produces DenySignal with HTTP 403 by default', () => {
    try {
      deny();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DenySignal);
      expect((e as DenySignal).status).toBe(403);
    }
  });

  it('deny(401) produces DenySignal with HTTP 401', () => {
    try {
      deny(401);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DenySignal);
      expect((e as DenySignal).status).toBe(401);
    }
  });

  it('render phase catching DenySignal produces correct status code response', async () => {
    const handler = createPipeline(
      makeConfig({
        render: () => {
          try {
            deny(403);
          } catch (e) {
            if (e instanceof DenySignal) {
              return new Response('Forbidden', { status: e.status });
            }
            throw e;
          }
          return new Response('OK');
        },
      })
    );

    const res = await handler(makeRequest('/admin'));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Forbidden');
  });

  it('deny(401) caught in render produces 401 with correct status file resolution', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('401', makeRouteFile('app/401.tsx'));

    const segments = [makeSegment({ segmentName: '', urlPath: '/', statusFiles })];
    const result = resolveStatusFile(401, segments);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    expect(result!.file.filePath).toBe('app/401.tsx');
  });

  it('deny(403) resolves 403.tsx from segment chain', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('403', makeRouteFile('app/dashboard/403.tsx'));

    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        statusFiles,
      }),
    ];

    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/dashboard/403.tsx');
  });
});

// ─── 404 Not Found ───────────────────────────────────────────────────────

describe('404 not found', () => {
  it('unmatched route returns HTTP 404', async () => {
    const handler = createPipeline(
      makeConfig({
        matchRoute: () => null,
      })
    );

    const res = await handler(makeRequest('/nonexistent'));
    expect(res.status).toBe(404);
  });

  it('unmatched route returns 404 even with proxy.ts', async () => {
    const handler = createPipeline({
      proxy: async (_req, next) => next(),
      matchRoute: () => null,
      render: okRender(),
    });

    const res = await handler(makeRequest('/nowhere'));
    expect(res.status).toBe(404);
  });

  it('404 status file resolves from segment chain', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('404', makeRouteFile('app/404.tsx'));

    const segments = [makeSegment({ segmentName: '', urlPath: '/', statusFiles })];
    const result = resolveStatusFile(404, segments);

    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/404.tsx');
    expect(result!.status).toBe(404);
  });
});

// ─── 500 Throw ───────────────────────────────────────────────────────────

describe('500 throw', () => {
  it('middleware throw produces HTTP 500 with no body', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async () => {
              throw new Error('middleware crash');
            },
          }),
      })
    );

    const res = await handler(makeRequest('/page'));
    expect(res.status).toBe(500);
    expect(res.body).toBeNull();

    errorSpy.mockRestore();
  });

  it('proxy throw produces HTTP 500 with no body', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = createPipeline(
      makeConfig({
        proxy: async () => {
          throw new Error('proxy crash');
        },
      })
    );

    const res = await handler(makeRequest('/page'));
    expect(res.status).toBe(500);
    expect(res.body).toBeNull();

    errorSpy.mockRestore();
  });

  it('RenderError carries structured digest but does not leak message', () => {
    const err = new RenderError('INTERNAL_ERROR', { id: '42' });
    expect(err.digest).toEqual({ code: 'INTERNAL_ERROR', data: { id: '42' } });
    expect(err.message).toContain('INTERNAL_ERROR');
    expect(err.status).toBe(500);
  });

  it('5xx status file resolves from segment chain for unhandled errors', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('5xx', makeRouteFile('app/5xx.tsx'));

    const segments = [makeSegment({ segmentName: '', urlPath: '/', statusFiles })];
    const result = resolveStatusFile(500, segments);

    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/5xx.tsx');
  });
});

// ─── route.ts 405 Method Not Allowed ─────────────────────────────────────

describe('405 method not allowed', () => {
  it('route.ts returning 405 for unsupported method', async () => {
    const exportedMethods = new Set(['GET']);

    const handler = createPipeline(
      makeConfig({
        matchRoute: (pathname) => {
          if (pathname === '/api/users') {
            return makeMatch({
              segments: [
                makeSegment({ segmentName: '', urlPath: '/' }),
                makeSegment({ segmentName: 'api', urlPath: '/api' }),
                makeSegment({
                  segmentName: 'users',
                  urlPath: '/api/users',
                  route: makeRouteFile('app/api/users/route.ts'),
                }),
              ],
            });
          }
          return null;
        },
        render: (req, _match) => {
          const method = req.method.toUpperCase();
          if (!exportedMethods.has(method)) {
            return new Response(null, {
              status: 405,
              headers: { Allow: Array.from(exportedMethods).join(', ') },
            });
          }
          return new Response(JSON.stringify({ users: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      })
    );

    const getRes = await handler(makeRequest('/api/users'));
    expect(getRes.status).toBe(200);

    const postRes = await handler(makeRequest('/api/users', { method: 'POST' }));
    expect(postRes.status).toBe(405);
    expect(postRes.headers.get('Allow')).toBe('GET');

    const deleteRes = await handler(makeRequest('/api/users', { method: 'DELETE' }));
    expect(deleteRes.status).toBe(405);
  });
});

// ─── Metadata Composition ────────────────────────────────────────────────

describe('metadata composition', () => {
  it('metadata resolves and composes across layouts (root → page)', () => {
    const entries: SegmentMetadataEntry[] = [
      {
        metadata: {
          title: { template: '%s | My App', default: 'My App' },
          description: 'Root description',
        },
        isPage: false,
      },
      {
        metadata: {
          title: 'Dashboard',
          description: 'Dashboard page',
        },
        isPage: true,
      },
    ];

    const resolved = resolveMetadata(entries);
    const elements = renderMetadataToElements(resolved);

    const titleEl = elements.find((e) => e.tag === 'title');
    expect(titleEl).toBeDefined();
    expect(titleEl!.content).toBe('Dashboard | My App');

    const descEl = elements.find((e) => e.attrs?.name === 'description');
    expect(descEl).toBeDefined();
    expect(descEl!.attrs!.content).toBe('Dashboard page');
  });

  it('metadata composition with three levels (root → dashboard → settings)', () => {
    const entries: SegmentMetadataEntry[] = [
      {
        metadata: {
          title: { template: '%s | My App', default: 'My App' },
          generator: 'timber.js',
        },
        isPage: false,
      },
      {
        metadata: {
          title: { template: '%s - Dashboard' },
          keywords: ['dashboard'],
        },
        isPage: false,
      },
      {
        metadata: {
          title: 'Settings',
          description: 'Manage your settings',
        },
        isPage: true,
      },
    ];

    const resolved = resolveMetadata(entries);
    const elements = renderMetadataToElements(resolved);

    const titleEl = elements.find((e) => e.tag === 'title');
    expect(titleEl!.content).toBe('Settings - Dashboard');
  });

  it('error state drops page metadata and injects noindex', () => {
    const entries: SegmentMetadataEntry[] = [
      {
        metadata: { title: { template: '%s | My App', default: 'My App' } },
        isPage: false,
      },
      {
        metadata: { title: 'Secret Page', description: 'Sensitive content' },
        isPage: true,
      },
    ];

    const resolved = resolveMetadata(entries, { errorState: true });
    const elements = renderMetadataToElements(resolved);

    const titleEl = elements.find((e) => e.tag === 'title');
    expect(titleEl!.content).toBe('My App');

    const robotsEl = elements.find((e) => e.attrs?.name === 'robots');
    expect(robotsEl).toBeDefined();
    expect(robotsEl!.attrs!.content).toBe('noindex');

    const descEl = elements.find((e) => e.attrs?.name === 'description');
    expect(descEl).toBeUndefined();
  });
});

// ─── Request Headers Overlay ─────────────────────────────────────────────

describe('request headers overlay', () => {
  it('middleware-injected request headers are visible downstream in render', async () => {
    let receivedOverlay: Headers | undefined;

    const handler = createPipeline({
      matchRoute: () =>
        makeMatch({
          middleware: async (ctx) => {
            ctx.requestHeaders.set('X-Locale', 'en-US');
            ctx.requestHeaders.set('X-Feature-Flag', 'dark-mode');
          },
        }),
      render: (_req, _match, _responseHeaders, requestHeaderOverlay) => {
        receivedOverlay = requestHeaderOverlay;
        return new Response('OK');
      },
    });

    const req = makeRequest('/page');
    await handler(req);

    expect(receivedOverlay!.get('X-Locale')).toBe('en-US');
    expect(receivedOverlay!.get('X-Feature-Flag')).toBe('dark-mode');

    // Original request is immutable
    expect(req.headers.get('X-Locale')).toBeNull();
    expect(req.headers.get('X-Feature-Flag')).toBeNull();
  });

  it('response headers set by middleware are applied to the response', async () => {
    const handler = createPipeline({
      matchRoute: () =>
        makeMatch({
          middleware: async (ctx) => {
            ctx.headers.set('Cache-Control', 'private, max-age=0');
            ctx.headers.set('X-Custom', 'test-value');
          },
        }),
      render: (_req, _match, responseHeaders) => {
        return new Response('OK', {
          status: 200,
          headers: {
            'Cache-Control': responseHeaders.get('Cache-Control') ?? '',
            'X-Custom': responseHeaders.get('X-Custom') ?? '',
          },
        });
      },
    });

    const res = await handler(makeRequest('/page'));
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=0');
    expect(res.headers.get('X-Custom')).toBe('test-value');
  });

  it('request header overlay is empty when no middleware sets headers', async () => {
    let receivedOverlay: Headers | undefined;

    const handler = createPipeline({
      matchRoute: () => makeMatch(),
      render: (_req, _match, _responseHeaders, requestHeaderOverlay) => {
        receivedOverlay = requestHeaderOverlay;
        return new Response('OK');
      },
    });

    await handler(makeRequest('/page'));
    expect(Array.from(receivedOverlay!.entries())).toHaveLength(0);
  });
});
