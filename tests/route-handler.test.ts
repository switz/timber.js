import { describe, it, expect, vi } from 'vitest';
import {
  handleRouteRequest,
  resolveAllowedMethods,
  type RouteModule,
} from '../packages/timber-app/src/server/route-handler';
import type { RouteContext } from '../packages/timber-app/src/server/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

function makeCtx(overrides?: Partial<RouteContext>): RouteContext {
  return {
    req: makeRequest('/api/test'),
    params: {},
    searchParams: new URLSearchParams(),
    headers: new Headers(),
    ...overrides,
  };
}

// ─── Method Exports ───────────────────────────────────────────────────────

describe('method exports', () => {
  it('GET handler receives RouteContext and returns Response', async () => {
    const mod: RouteModule = {
      GET: async (ctx: RouteContext) => Response.json({ id: ctx.params.id }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users/42', { method: 'GET' }),
      params: { id: '42' },
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: '42' });
  });

  it('POST handler works', async () => {
    const mod: RouteModule = {
      POST: async () => new Response(null, { status: 201 }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users', { method: 'POST', body: '{}' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(201);
  });

  it('PUT handler works', async () => {
    const mod: RouteModule = {
      PUT: async () => new Response(null, { status: 204 }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users/1', { method: 'PUT', body: '{}' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(204);
  });

  it('PATCH handler works', async () => {
    const mod: RouteModule = {
      PATCH: async () => Response.json({ patched: true }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users/1', { method: 'PATCH', body: '{}' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(200);
  });

  it('DELETE handler works', async () => {
    const mod: RouteModule = {
      DELETE: async () => new Response(null, { status: 204 }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users/1', { method: 'DELETE' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(204);
  });

  it('HEAD handler works', async () => {
    const mod: RouteModule = {
      HEAD: async () => new Response(null, { status: 200, headers: { 'X-Count': '5' } }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users', { method: 'HEAD' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Count')).toBe('5');
  });
});

// ─── 405 Allow Header ────────────────────────────────────────────────────

describe('405 allow header', () => {
  it('returns 405 for unhandled method with Allow header', async () => {
    const mod: RouteModule = {
      GET: async () => Response.json([]),
      POST: async () => new Response(null, { status: 201 }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users', { method: 'DELETE' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, POST, HEAD, OPTIONS');
  });

  it('405 response has no body', async () => {
    const mod: RouteModule = {
      GET: async () => Response.json([]),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users', { method: 'PUT' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(405);
    expect(res.body).toBeNull();
  });

  it('Allow header includes implicit HEAD when GET is exported', async () => {
    const mod: RouteModule = {
      GET: async () => Response.json({ ok: true }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/health', { method: 'PATCH', body: '{}' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    const allow = res.headers.get('Allow');
    expect(allow).toContain('GET');
    expect(allow).toContain('HEAD');
    expect(allow).toContain('OPTIONS');
  });
});

// ─── Auto OPTIONS ─────────────────────────────────────────────────────────

describe('auto OPTIONS', () => {
  it('generates OPTIONS response listing allowed methods', async () => {
    const mod: RouteModule = {
      GET: async () => Response.json([]),
      POST: async () => new Response(null, { status: 201 }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users', { method: 'OPTIONS' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get('Allow')).toBe('GET, POST, HEAD, OPTIONS');
    expect(res.body).toBeNull();
  });

  it('uses explicit OPTIONS export when provided', async () => {
    const mod: RouteModule = {
      GET: async () => Response.json([]),
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
          },
        }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users', { method: 'OPTIONS' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET');
  });
});

// ─── One-Arg Context ──────────────────────────────────────────────────────

describe('one-arg context', () => {
  it('handler receives full RouteContext', async () => {
    let captured: RouteContext | undefined;

    const mod: RouteModule = {
      GET: async (ctx: RouteContext) => {
        captured = ctx;
        return Response.json({ ok: true });
      },
    };

    const req = makeRequest('/api/users?page=2');
    const searchParams = new URL(req.url).searchParams;

    const ctx = makeCtx({
      req,
      params: { org: 'acme' },
      searchParams,
    });

    await handleRouteRequest(mod, ctx);

    expect(captured).toBeDefined();
    expect(captured!.req).toBe(req);
    expect(captured!.params).toEqual({ org: 'acme' });
    expect(captured!.searchParams.get('page')).toBe('2');
    expect(captured!.headers).toBeInstanceOf(Headers);
  });

  it('response headers from ctx.headers are applied to response', async () => {
    const mod: RouteModule = {
      GET: async (ctx: RouteContext) => {
        ctx.headers.set('X-Custom', 'value');
        return Response.json({ ok: true });
      },
    };

    const ctx = makeCtx({
      req: makeRequest('/api/test'),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.headers.get('X-Custom')).toBe('value');
  });
});

// ─── Streaming SSE ────────────────────────────────────────────────────────

describe('streaming SSE', () => {
  it('supports ReadableStream response for SSE', async () => {
    const mod: RouteModule = {
      GET: async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: hello\n\n'));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        });
      },
    };

    const ctx = makeCtx({
      req: makeRequest('/api/events'),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const text = await res.text();
    expect(text).toBe('data: hello\n\n');
  });
});

// ─── Full Pipeline ────────────────────────────────────────────────────────

describe('full pipeline', () => {
  it('route handler integrates with pipeline (proxy → match → middleware → handler)', async () => {
    // This tests the conceptual integration: the route handler receives
    // the same context shape that the pipeline constructs after middleware.
    const order: string[] = [];

    const mod: RouteModule = {
      GET: async (ctx: RouteContext) => {
        order.push('handler');
        return Response.json({ id: ctx.params.id });
      },
    };

    // Simulate middleware setting response headers
    const responseHeaders = new Headers();
    responseHeaders.set('X-Via', 'middleware');

    const ctx: RouteContext = {
      req: makeRequest('/api/users/42'),
      params: { id: '42' },
      searchParams: new URL('http://localhost/api/users/42').searchParams,
      headers: responseHeaders,
    };

    order.push('middleware');
    const res = await handleRouteRequest(mod, ctx);
    order.push('done');

    expect(order).toEqual(['middleware', 'handler', 'done']);
    expect(res.status).toBe(200);
    // Response headers from ctx.headers are merged
    expect(res.headers.get('X-Via')).toBe('middleware');
  });

  it('handler error returns 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mod: RouteModule = {
      GET: async () => {
        throw new Error('db connection failed');
      },
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users'),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(500);
    expect(res.body).toBeNull();

    errorSpy.mockRestore();
  });
});

// ─── resolveAllowedMethods ───────────────────────────────────────────────

describe('resolveAllowedMethods', () => {
  it('returns exported methods plus HEAD (when GET exists) and OPTIONS', () => {
    const mod: RouteModule = { GET: async () => new Response() };
    expect(resolveAllowedMethods(mod)).toEqual(['GET', 'HEAD', 'OPTIONS']);
  });

  it('includes all exported methods', () => {
    const mod: RouteModule = {
      GET: async () => new Response(),
      POST: async () => new Response(),
      DELETE: async () => new Response(),
    };
    expect(resolveAllowedMethods(mod)).toEqual(['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS']);
  });

  it('does not duplicate HEAD if explicitly exported', () => {
    const mod: RouteModule = {
      GET: async () => new Response(),
      HEAD: async () => new Response(),
    };
    const methods = resolveAllowedMethods(mod);
    expect(methods.filter((m) => m === 'HEAD')).toHaveLength(1);
  });

  it('does not duplicate OPTIONS if explicitly exported', () => {
    const mod: RouteModule = {
      GET: async () => new Response(),
      OPTIONS: async () => new Response(),
    };
    const methods = resolveAllowedMethods(mod);
    expect(methods.filter((m) => m === 'OPTIONS')).toHaveLength(1);
  });

  it('no HEAD when GET is not exported', () => {
    const mod: RouteModule = {
      POST: async () => new Response(),
    };
    const methods = resolveAllowedMethods(mod);
    expect(methods).not.toContain('HEAD');
    expect(methods).toEqual(['POST', 'OPTIONS']);
  });
});

// ─── HEAD via GET fallback ───────────────────────────────────────────────

describe('implicit HEAD via GET', () => {
  it('HEAD request uses GET handler when HEAD not exported', async () => {
    const mod: RouteModule = {
      GET: async () =>
        new Response('full body', {
          headers: { 'Content-Type': 'application/json', 'X-Custom': 'yes' },
        }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users', { method: 'HEAD' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('X-Custom')).toBe('yes');
    // HEAD response must have no body
    const text = await res.text();
    expect(text).toBe('');
  });

  it('explicit HEAD export takes priority over GET fallback', async () => {
    const mod: RouteModule = {
      GET: async () => Response.json({ full: true }),
      HEAD: async () =>
        new Response(null, { status: 200, headers: { 'X-Source': 'explicit-head' } }),
    };

    const ctx = makeCtx({
      req: makeRequest('/api/users', { method: 'HEAD' }),
    });

    const res = await handleRouteRequest(mod, ctx);
    expect(res.headers.get('X-Source')).toBe('explicit-head');
  });
});
