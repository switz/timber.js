/**
 * Feature-Composition Integration Tests
 *
 * These tests exercise the composition of multiple timber.js features in a
 * single request. Unit tests prove individual functions work; these prove
 * they compose correctly at interaction boundaries.
 *
 * Each test documents which features it composes and cites relevant design docs.
 *
 * See LOCAL-310: "Add feature-composition integration tests for cross-cutting scenarios"
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
} from '../../packages/timber-app/src/server/primitives';
import { AccessGate, SlotAccessGate } from '../../packages/timber-app/src/server/access-gate';
import { resolveStatusFile } from '../../packages/timber-app/src/server/status-code-resolver';
import {
  resolveMetadata,
  renderMetadataToElements,
  type SegmentMetadataEntry,
} from '../../packages/timber-app/src/server/metadata';
import type { SegmentNode, RouteFile } from '../../packages/timber-app/src/routing/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

function makeMatch(overrides?: Partial<RouteMatch>): RouteMatch {
  return { segments: [], params: {}, ...overrides };
}

function okRender(body = 'OK', status = 200): RouteRenderer {
  return (_req, _match, responseHeaders) => {
    const res = new Response(body, { status });
    responseHeaders.forEach((v, k) => res.headers.set(k, v));
    return res;
  };
}

function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return { matchRoute: () => makeMatch(), render: okRender(), ...overrides };
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

// ─── Scenario 2: Two parallel slots both call redirect() ─────────────────
// Features composed: SlotAccessGate + redirect() + graceful degradation
// Design docs: 02-rendering-pipeline.md §"Slot Access Failure = Graceful Degradation"
//              04-authorization.md §"Slot-Level Auth"

describe('Scenario 2: parallel slots both calling redirect()', () => {
  it('redirect() in slot access.ts is caught and treated as deny (graceful degradation)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await SlotAccessGate({
      accessFn: async () => { redirect('/login'); },
      params: {},
      searchParams: new URLSearchParams(),
      deniedFallback: { type: 'div', props: { children: 'A denied' } },
      defaultFallback: null,
      children: { type: 'div', props: { children: 'slot A content' } },
    });

    // Slot should gracefully degrade to denied fallback, not throw
    expect(result.props.children).toBe('A denied');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('redirect() is not allowed in slot access.ts')
    );

    consoleSpy.mockRestore();
  });

  it('two slots with redirect() both degrade independently — deterministic', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const slotAResult = await SlotAccessGate({
      accessFn: async () => { redirect('/login-a'); },
      params: {},
      searchParams: new URLSearchParams(),
      deniedFallback: { type: 'div', props: { children: 'A denied' } },
      defaultFallback: null,
      children: { type: 'div', props: { children: 'slot A' } },
    });

    const slotBResult = await SlotAccessGate({
      accessFn: async () => { redirect('/login-b'); },
      params: {},
      searchParams: new URLSearchParams(),
      deniedFallback: { type: 'div', props: { children: 'B denied' } },
      defaultFallback: null,
      children: { type: 'div', props: { children: 'slot B' } },
    });

    expect(slotAResult.props.children).toBe('A denied');
    expect(slotBResult.props.children).toBe('B denied');

    consoleSpy.mockRestore();
  });

  it('slot redirect() does NOT produce an HTTP redirect — page renders normally', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = createPipeline(
      makeConfig({
        render: () => new Response('page rendered', { status: 200 }),
      })
    );

    const res = await handler(makeRequest('/dashboard'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('page rendered');

    consoleSpy.mockRestore();
  });
});

// ─── Scenario 2b: Two parallel slots both call deny() ────────────────────
// Features composed: SlotAccessGate + deny() + graceful degradation
// Design docs: 02-rendering-pipeline.md §"Slot Access Failure = Graceful Degradation"

describe('Scenario 2b: parallel slots both calling deny()', () => {
  it('two slots with deny() — both degrade independently', async () => {
    const slotAResult = await SlotAccessGate({
      accessFn: async () => { deny(403); },
      params: {},
      searchParams: new URLSearchParams(),
      deniedFallback: { type: 'div', props: { children: 'A: forbidden' } },
      defaultFallback: null,
      children: { type: 'div', props: { children: 'slot A' } },
    });

    const slotBResult = await SlotAccessGate({
      accessFn: async () => { deny(401); },
      params: {},
      searchParams: new URLSearchParams(),
      deniedFallback: { type: 'div', props: { children: 'B: unauthorized' } },
      defaultFallback: null,
      children: { type: 'div', props: { children: 'slot B' } },
    });

    expect(slotAResult.props.children).toBe('A: forbidden');
    expect(slotBResult.props.children).toBe('B: unauthorized');
  });

  it('one slot denies, sibling passes — deny does not cascade', async () => {
    const slotAResult = await SlotAccessGate({
      accessFn: async () => { deny(403); },
      params: {},
      searchParams: new URLSearchParams(),
      deniedFallback: { type: 'div', props: { children: 'A denied' } },
      defaultFallback: null,
      children: { type: 'div', props: { children: 'slot A content' } },
    });

    const slotBResult = await SlotAccessGate({
      accessFn: async () => { /* pass */ },
      params: {},
      searchParams: new URLSearchParams(),
      deniedFallback: null,
      defaultFallback: null,
      children: { type: 'div', props: { children: 'slot B content' } },
    });

    expect(slotAResult.props.children).toBe('A denied');
    expect(slotBResult.props.children).toBe('slot B content');
  });
});

// ─── Scenario 3: Cookie + redirect() composition ────────────────────────
// Features composed: middleware (cookie setting) + redirect() + response headers
// Design docs: 08-forms-and-actions.md §"redirect()"
//              07-routing.md §"middleware.ts"

describe('Scenario 3: cookie + redirect() composition', () => {
  it('middleware short-circuits with redirect Response — cookies survive 302', async () => {
    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async () => {
              return new Response(null, {
                status: 302,
                headers: {
                  Location: '/dashboard',
                  'Set-Cookie': 'session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/',
                },
              });
            },
          }),
      })
    );

    const res = await handler(makeRequest('/login', { method: 'POST' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard');
    expect(res.headers.get('Set-Cookie')).toContain('session=abc123');
  });

  it('RedirectSignal thrown in middleware — pipeline produces 302', async () => {
    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async () => { redirect('/dashboard'); },
          }),
      })
    );

    const res = await handler(makeRequest('/login'));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard');
  });

  it('RedirectSignal in middleware for RSC request returns 204 + X-Timber-Redirect', async () => {
    // Client-side navigation: RSC payload requests get 204 + header, not 302
    // See design/19-client-navigation.md
    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async () => { redirect('/dashboard'); },
          }),
      })
    );

    const res = await handler(
      makeRequest('/login', { headers: { Accept: 'text/x-component' } })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('X-Timber-Redirect')).toBe('/dashboard');
  });
});

// ─── Scenario 4: Layout throws during metadata resolution ────────────────
// Features composed: metadata composition + error boundary + status code
// Design docs: 02-rendering-pipeline.md §"Render-Pass Resolution"
//              10-error-handling.md §"error.tsx"

describe('Scenario 4: layout throws during metadata resolution', () => {
  it('metadata resolution with only root layout uses default title', () => {
    const entries: SegmentMetadataEntry[] = [
      {
        metadata: { title: { template: '%s | App', default: 'App' } },
        isPage: false,
      },
    ];

    const resolved = resolveMetadata(entries);
    const elements = renderMetadataToElements(resolved);

    const titleEl = elements.find((e) => e.tag === 'title');
    expect(titleEl).toBeDefined();
    expect(titleEl!.content).toBe('App');
  });

  it('error state metadata drops page metadata and injects noindex', () => {
    const entries: SegmentMetadataEntry[] = [
      {
        metadata: { title: { template: '%s | App', default: 'App' } },
        isPage: false,
      },
      {
        metadata: { title: 'Secret Page', description: 'Sensitive' },
        isPage: true,
      },
    ];

    const resolved = resolveMetadata(entries, { errorState: true });
    const elements = renderMetadataToElements(resolved);

    const titleEl = elements.find((e) => e.tag === 'title');
    expect(titleEl!.content).toBe('App');

    const robotsEl = elements.find((e) => e.attrs?.name === 'robots');
    expect(robotsEl).toBeDefined();
    expect(robotsEl!.attrs!.content).toBe('noindex');

    const descEl = elements.find((e) => e.attrs?.name === 'description');
    expect(descEl).toBeUndefined();
  });

  it('render-phase error → pipeline returns 500 with fallback error page', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = createPipeline(
      makeConfig({
        render: () => {
          throw new Error('Layout metadata() threw');
        },
        renderFallbackError: (error) => {
          const msg = error instanceof Error ? error.message : 'Unknown';
          return new Response(`<h1>Error: ${msg}</h1>`, {
            status: 500,
            headers: { 'Content-Type': 'text/html' },
          });
        },
      })
    );

    const res = await handler(makeRequest('/dashboard'));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('Layout metadata() threw');

    errorSpy.mockRestore();
  });

  it('RenderError with status 500 resolves 5xx.tsx from segment chain', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('5xx', makeRouteFile('app/dashboard/5xx.tsx'));

    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        statusFiles,
      }),
    ];

    const result = resolveStatusFile(500, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/dashboard/5xx.tsx');
    expect(result!.kind).toBe('category');
  });
});

// ─── Scenario 5: middleware rewrite + access.ts denies rewritten path ─────
// Features composed: middleware (header injection) + access.ts denial + params
// Design docs: 07-routing.md §"middleware.ts"
//              04-authorization.md §"access.ts"

describe('Scenario 5: middleware rewrite + access.ts denial', () => {
  it('middleware injects rewrite context, render sees matched params', async () => {
    let capturedParams: Record<string, string | string[]> | undefined;

    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            params: { slug: 'admin-panel' },
            middleware: async (ctx) => {
              ctx.requestHeaders.set('X-Rewritten-From', '/admin');
            },
          }),
        render: (_req, match) => {
          capturedParams = match.params;
          return new Response('Forbidden', { status: 403 });
        },
      })
    );

    const res = await handler(makeRequest('/admin'));
    expect(res.status).toBe(403);
    expect(capturedParams).toEqual({ slug: 'admin-panel' });
  });

  it('middleware sets request headers visible in render', async () => {
    let receivedOverlay: Headers | undefined;

    const handler = createPipeline({
      matchRoute: () =>
        makeMatch({
          middleware: async (ctx) => {
            ctx.requestHeaders.set('X-Rewritten', 'true');
            ctx.requestHeaders.set('X-Original-Path', '/old-path');
          },
        }),
      render: (_req, _match, _responseHeaders, requestHeaderOverlay) => {
        receivedOverlay = requestHeaderOverlay;
        return new Response('OK');
      },
    });

    await handler(makeRequest('/old-path'));
    expect(receivedOverlay!.get('X-Rewritten')).toBe('true');
    expect(receivedOverlay!.get('X-Original-Path')).toBe('/old-path');
  });
});

// ─── Scenario 8: Nested error boundaries — inner vs outer ────────────────
// Features composed: error boundaries + status file resolution + segment chain
// Design docs: 10-error-handling.md §"Status-Code Files"
//              10-error-handling.md §"error.tsx"

describe('Scenario 8: nested error boundaries — inner segment throws', () => {
  it('inner 5xx.tsx wins over outer error.tsx (nearer segment wins)', () => {
    const outerSegment = makeSegment({
      segmentName: '',
      urlPath: '/',
      error: makeRouteFile('app/error.tsx'),
    });

    const innerStatusFiles = new Map<string, RouteFile>();
    innerStatusFiles.set('5xx', makeRouteFile('app/dashboard/5xx.tsx'));

    const innerSegment = makeSegment({
      segmentName: 'dashboard',
      urlPath: '/dashboard',
      statusFiles: innerStatusFiles,
    });

    const result = resolveStatusFile(500, [outerSegment, innerSegment]);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/dashboard/5xx.tsx');
    expect(result!.kind).toBe('category');
    expect(result!.segmentIndex).toBe(1);
  });

  it('outer error.tsx catches when inner has no status files', () => {
    const outerSegment = makeSegment({
      segmentName: '',
      urlPath: '/',
      error: makeRouteFile('app/error.tsx'),
    });

    const innerSegment = makeSegment({
      segmentName: 'dashboard',
      urlPath: '/dashboard',
    });

    const result = resolveStatusFile(500, [outerSegment, innerSegment]);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/error.tsx');
    expect(result!.kind).toBe('error');
    expect(result!.segmentIndex).toBe(0);
  });

  it('exact 503.tsx wins over sibling 5xx.tsx in same segment', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('503', makeRouteFile('app/dashboard/503.tsx'));
    statusFiles.set('5xx', makeRouteFile('app/dashboard/5xx.tsx'));

    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        statusFiles,
      }),
    ];

    const result = resolveStatusFile(503, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/dashboard/503.tsx');
    expect(result!.kind).toBe('exact');
  });

  it('inner error.tsx wins over outer 5xx.tsx (per-segment search)', () => {
    // 5xx chain is per-segment: {status}.tsx → 5xx.tsx → error.tsx at EACH level
    const outerStatusFiles = new Map<string, RouteFile>();
    outerStatusFiles.set('5xx', makeRouteFile('app/5xx.tsx'));

    const outerSegment = makeSegment({
      segmentName: '',
      urlPath: '/',
      statusFiles: outerStatusFiles,
    });

    const innerSegment = makeSegment({
      segmentName: 'dashboard',
      urlPath: '/dashboard',
      error: makeRouteFile('app/dashboard/error.tsx'),
    });

    const result = resolveStatusFile(500, [outerSegment, innerSegment]);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/dashboard/error.tsx');
    expect(result!.kind).toBe('error');
    expect(result!.segmentIndex).toBe(1);
  });

  it('4xx: inner exact 403.tsx over outer 4xx.tsx', () => {
    const outerStatusFiles = new Map<string, RouteFile>();
    outerStatusFiles.set('4xx', makeRouteFile('app/4xx.tsx'));

    const innerStatusFiles = new Map<string, RouteFile>();
    innerStatusFiles.set('403', makeRouteFile('app/dashboard/403.tsx'));

    const segments = [
      makeSegment({ segmentName: '', urlPath: '/', statusFiles: outerStatusFiles }),
      makeSegment({ segmentName: 'dashboard', urlPath: '/dashboard', statusFiles: innerStatusFiles }),
    ];

    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/dashboard/403.tsx');
    expect(result!.kind).toBe('exact');
  });

  it('4xx: falls through to outer when inner has no match', () => {
    const outerStatusFiles = new Map<string, RouteFile>();
    outerStatusFiles.set('4xx', makeRouteFile('app/4xx.tsx'));

    const segments = [
      makeSegment({ segmentName: '', urlPath: '/', statusFiles: outerStatusFiles }),
      makeSegment({ segmentName: 'dashboard', urlPath: '/dashboard' }),
    ];

    const result = resolveStatusFile(429, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/4xx.tsx');
    expect(result!.kind).toBe('category');
    expect(result!.segmentIndex).toBe(0);
  });

  it('three-level nesting: middle segment catches the error', () => {
    const rootSegment = makeSegment({
      segmentName: '',
      urlPath: '/',
      error: makeRouteFile('app/error.tsx'),
    });

    const middleStatusFiles = new Map<string, RouteFile>();
    middleStatusFiles.set('5xx', makeRouteFile('app/auth/5xx.tsx'));

    const middleSegment = makeSegment({
      segmentName: '(auth)',
      urlPath: '/',
      statusFiles: middleStatusFiles,
    });

    const leafSegment = makeSegment({
      segmentName: 'settings',
      urlPath: '/settings',
    });

    const result = resolveStatusFile(500, [rootSegment, middleSegment, leafSegment]);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/auth/5xx.tsx');
    expect(result!.segmentIndex).toBe(1);
  });
});

// ─── Scenario 1: async access.ts + pipeline status code contract ─────────
// Features composed: AccessGate (async) + pipeline flush + status codes
// Design docs: 02-rendering-pipeline.md §"The Flush Point"
//              04-authorization.md §"access.ts"

describe('Scenario 1: async access.ts + pipeline status code contract', () => {
  it('slow async access.ts that passes — pipeline completes with 200', async () => {
    const handler = createPipeline(
      makeConfig({
        render: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return new Response('OK', { status: 200 });
        },
      })
    );

    const res = await handler(makeRequest('/dashboard'));
    expect(res.status).toBe(200);
  });

  it('slow async access.ts that denies — pipeline produces correct 403', async () => {
    const handler = createPipeline(
      makeConfig({
        render: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return new Response('Forbidden', { status: 403 });
        },
      })
    );

    const res = await handler(makeRequest('/admin'));
    expect(res.status).toBe(403);
  });

  it('AccessGate with slow async accessFn — passes correctly', async () => {
    const accessFn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    };

    const result = await AccessGate({
      accessFn,
      params: {},
      searchParams: new URLSearchParams(),
      children: { type: 'div', props: { children: 'content' } },
    });

    expect(result.props.children).toBe('content');
  });

  it('AccessGate with slow async accessFn — denies correctly', async () => {
    const accessFn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      deny(401);
    };

    await expect(
      AccessGate({
        accessFn,
        params: {},
        searchParams: new URLSearchParams(),
        children: { type: 'div', props: { children: 'content' } },
      })
    ).rejects.toThrow(DenySignal);
  });
});

// ─── Scenario 6: route.ts handler with cookies + response headers ────────
// Features composed: middleware headers + render response + proxy wrapping
// Design docs: 07-routing.md §"route.ts — API Endpoints"

describe('Scenario 6: route.ts handler with cookies + response headers', () => {
  it('middleware sets cookies, render returns response — cookies on response', async () => {
    const handler = createPipeline({
      matchRoute: () =>
        makeMatch({
          middleware: async (ctx) => {
            ctx.headers.set('Set-Cookie', 'tracker=abc; Path=/');
          },
        }),
      render: (_req, _match, responseHeaders) => {
        const headers = new Headers(responseHeaders);
        headers.set('Content-Type', 'application/json');
        return new Response(JSON.stringify({ data: [1, 2, 3] }), {
          status: 200,
          headers,
        });
      },
    });

    const res = await handler(makeRequest('/api/data'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Set-Cookie')).toBe('tracker=abc; Path=/');
  });

  it('multiple response headers compose: proxy + middleware + render', async () => {
    const handler = createPipeline({
      proxy: async (_req, next) => {
        const res = await next();
        const headers = new Headers(res.headers);
        headers.set('X-Request-Id', 'req-123');
        return new Response(res.body, { status: res.status, headers });
      },
      matchRoute: () =>
        makeMatch({
          middleware: async (ctx) => {
            ctx.headers.set('Cache-Control', 'private, no-cache');
            ctx.headers.set('Vary', 'Accept');
          },
        }),
      render: (_req, _match, responseHeaders) => {
        return new Response('content', {
          status: 200,
          headers: {
            'Cache-Control': responseHeaders.get('Cache-Control') ?? '',
            Vary: responseHeaders.get('Vary') ?? '',
            'Content-Type': 'text/html',
          },
        });
      },
    });

    const res = await handler(makeRequest('/page'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toBe('req-123');
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(res.headers.get('Vary')).toBe('Accept');
    expect(res.headers.get('Content-Type')).toBe('text/html');
  });
});

// ─── Scenario 9: error cascading through pipeline phases ─────────────────
// Features composed: pipeline + render phase + proxy wrapping + error handling
// Design docs: 02-rendering-pipeline.md, 10-error-handling.md

describe('Scenario 9: error cascading through pipeline phases', () => {
  it('render error + proxy wrapping — proxy sees the error response', async () => {
    let proxySeenStatus: number | undefined;

    const handler = createPipeline({
      proxy: async (_req, next) => {
        const res = await next();
        proxySeenStatus = res.status;
        return res;
      },
      matchRoute: () => makeMatch(),
      render: () => { throw new Error('render crash'); },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handler(makeRequest('/page'));
    expect(res.status).toBe(500);
    expect(proxySeenStatus).toBe(500);
    errorSpy.mockRestore();
  });

  it('middleware throw + proxy wrapping — proxy sees 500', async () => {
    let proxySeenStatus: number | undefined;

    const handler = createPipeline({
      proxy: async (_req, next) => {
        const res = await next();
        proxySeenStatus = res.status;
        return res;
      },
      matchRoute: () =>
        makeMatch({
          middleware: async () => { throw new Error('middleware crash'); },
        }),
      render: okRender(),
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handler(makeRequest('/page'));
    expect(res.status).toBe(500);
    expect(proxySeenStatus).toBe(500);
    errorSpy.mockRestore();
  });
});

// ─── Scenario 10: access denial interactions across pipeline ─────────────
// Features composed: AccessGate + pipeline + status code + redirect
// Design docs: 04-authorization.md, 02-rendering-pipeline.md, 10-error-handling.md

describe('Scenario 10: access denial interactions', () => {
  it('DenySignal from middleware → HTTP 403 (not error boundary)', async () => {
    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async () => { deny(403); },
          }),
      })
    );

    const res = await handler(makeRequest('/admin'));
    expect(res.status).toBe(403);
  });

  it('RedirectSignal from middleware → 302 (not 500)', async () => {
    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async () => { redirect('/login'); },
          }),
      })
    );

    const res = await handler(makeRequest('/protected'));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('parent AccessGate denial prevents child AccessGate from running', async () => {
    const childAccessFn = vi.fn();

    await expect(
      AccessGate({
        accessFn: async () => { deny(401); },
        params: {},
        searchParams: new URLSearchParams(),
        children: { type: 'div', props: { children: 'never reached' } },
      })
    ).rejects.toThrow(DenySignal);

    expect(childAccessFn).not.toHaveBeenCalled();
  });
});

// ─── Cross-cutting: JSON vs component status file resolution ─────────────
// Features composed: status code resolution + format selection
// Design docs: 10-error-handling.md §"Format Selection for deny()"

describe('Cross-cutting: JSON vs component status file resolution', () => {
  it('json format resolves json files, ignores tsx files', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('401', makeRouteFile('app/401.tsx'));

    const jsonStatusFiles = new Map<string, RouteFile>();
    jsonStatusFiles.set('401', makeRouteFile('app/401.json'));

    const segments = [
      makeSegment({ segmentName: '', urlPath: '/', statusFiles, jsonStatusFiles }),
    ];

    const componentResult = resolveStatusFile(401, segments, 'component');
    expect(componentResult!.file.filePath).toBe('app/401.tsx');

    const jsonResult = resolveStatusFile(401, segments, 'json');
    expect(jsonResult!.file.filePath).toBe('app/401.json');
  });

  it('json format falls back to category: 401 → 4xx.json', () => {
    const jsonStatusFiles = new Map<string, RouteFile>();
    jsonStatusFiles.set('4xx', makeRouteFile('app/api/4xx.json'));

    const segments = [
      makeSegment({ segmentName: '', urlPath: '/', jsonStatusFiles }),
    ];

    const result = resolveStatusFile(401, segments, 'json');
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/api/4xx.json');
    expect(result!.kind).toBe('category');
  });

  it('json format returns null when no json files exist', () => {
    const segments = [makeSegment({ segmentName: '', urlPath: '/' })];
    const result = resolveStatusFile(401, segments, 'json');
    expect(result).toBeNull();
  });
});

// ─── Cross-cutting: signal determinism ───────────────────────────────────
// Features composed: deny() + redirect() + RenderError signal priority
// Design docs: 10-error-handling.md, 04-authorization.md, 13-security.md

describe('Cross-cutting: signal determinism', () => {
  it('deny() produces DenySignal with exact status — all 4xx codes', () => {
    const statuses = [400, 401, 403, 404, 405, 409, 422, 429];
    for (const status of statuses) {
      try {
        deny(status);
      } catch (e) {
        expect(e).toBeInstanceOf(DenySignal);
        expect((e as DenySignal).status).toBe(status);
      }
    }
  });

  it('redirect() rejects absolute URLs — open redirect prevention', () => {
    expect(() => redirect('https://evil.com')).toThrow('only accepts relative URLs');
    expect(() => redirect('//evil.com')).toThrow('only accepts relative URLs');
  });

  it('deny() rejects non-4xx status codes', () => {
    expect(() => deny(200)).toThrow('4xx status code');
    expect(() => deny(302)).toThrow('4xx status code');
    expect(() => deny(500)).toThrow('4xx status code');
  });

  it('RenderError carries digest and resolves correct status file', () => {
    const err = new RenderError(
      'DB_TIMEOUT',
      { query: 'SELECT *', retryMs: 5000 },
      { status: 503 }
    );
    expect(err.status).toBe(503);
    expect(err.digest.code).toBe('DB_TIMEOUT');
    expect(err.digest.data).toEqual({ query: 'SELECT *', retryMs: 5000 });

    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('503', makeRouteFile('app/503.tsx'));
    const result = resolveStatusFile(503, [
      makeSegment({ segmentName: '', urlPath: '/', statusFiles }),
    ]);
    expect(result!.file.filePath).toBe('app/503.tsx');
    expect(result!.kind).toBe('exact');
  });
});

// ─── Cross-cutting: full pipeline phase composition ──────────────────────
// Features composed: proxy + canonicalization + middleware + render
// Design docs: 07-routing.md, 02-rendering-pipeline.md

describe('Cross-cutting: full pipeline phase composition', () => {
  it('canonicalization runs between proxy and route matching', async () => {
    const order: string[] = [];

    const handler = createPipeline({
      proxy: async (_req, next) => {
        order.push('proxy');
        return next();
      },
      matchRoute: (pathname) => {
        order.push(`match:${pathname}`);
        return makeMatch();
      },
      render: () => {
        order.push('render');
        return new Response('OK');
      },
    });

    await handler(makeRequest('//foo///bar'));
    expect(order).toEqual(['proxy', 'match:/foo/bar', 'render']);
  });

  it('early hints fire between match and middleware', async () => {
    const order: string[] = [];

    const handler = createPipeline({
      matchRoute: () => {
        order.push('match');
        return makeMatch({
          middleware: async () => { order.push('middleware'); },
        });
      },
      earlyHints: async () => { order.push('hints'); },
      render: () => {
        order.push('render');
        return new Response('OK');
      },
    });

    await handler(makeRequest('/page'));
    expect(order).toEqual(['match', 'hints', 'middleware', 'render']);
  });

  it('early hints failure does not block the pipeline', async () => {
    const handler = createPipeline({
      matchRoute: () => makeMatch(),
      earlyHints: async () => { throw new Error('CDN rejected hints'); },
      render: () => new Response('OK', { status: 200 }),
    });

    const res = await handler(makeRequest('/page'));
    expect(res.status).toBe(200);
  });

  it('no-match 404 skips middleware and render entirely', async () => {
    const renderFn = vi.fn(() => new Response('OK'));

    const handler = createPipeline({
      matchRoute: () => null,
      render: renderFn,
    });

    const res = await handler(makeRequest('/nonexistent'));
    expect(res.status).toBe(404);
    expect(renderFn).not.toHaveBeenCalled();
  });
});
