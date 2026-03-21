import { describe, it, expect, vi } from 'vitest';
import {
  createPipeline,
  type PipelineConfig,
  type RouteMatch,
} from '../packages/timber-app/src/server/pipeline';
import { runProxy, type ProxyFn } from '../packages/timber-app/src/server/proxy';
import {
  runMiddleware,
  type MiddlewareFn,
} from '../packages/timber-app/src/server/middleware-runner';
import type { MiddlewareContext } from '../packages/timber-app/src/server/types';
import { headers } from '../packages/timber-app/src/server/request-context';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

/** Minimal route match for testing. */
function makeMatch(overrides?: Partial<RouteMatch>): RouteMatch {
  return {
    segments: [],
    params: {},
    ...overrides,
  };
}

/** Default render that returns 200. */
function okRender(): PipelineConfig['render'] {
  return (_req, _match, responseHeaders) => {
    const res = new Response('OK', { status: 200 });
    responseHeaders.forEach((v, k) => res.headers.set(k, v));
    return res;
  };
}

/** Create a pipeline config with sensible defaults. */
function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    matchRoute: () => makeMatch(),
    render: okRender(),
    ...overrides,
  };
}

// ─── proxy.ts ─────────────────────────────────────────────────────────────

describe('proxy.ts', () => {
  it('proxy runs before match', async () => {
    const order: string[] = [];

    const handler = createPipeline(
      makeConfig({
        proxy: async (_req, next) => {
          order.push('proxy');
          return next();
        },
        matchRoute: (_pathname) => {
          order.push('match');
          return makeMatch();
        },
      })
    );

    await handler(makeRequest('/test'));
    expect(order).toEqual(['proxy', 'match']);
  });

  it('proxy array composition', async () => {
    const order: string[] = [];

    const a: ProxyFn = async (_req, next) => {
      order.push('a');
      return next();
    };
    const b: ProxyFn = async (_req, next) => {
      order.push('b');
      return next();
    };
    const c: ProxyFn = async (_req, next) => {
      order.push('c');
      return next();
    };

    const handler = createPipeline(
      makeConfig({
        proxy: [a, b, c],
      })
    );

    await handler(makeRequest('/test'));
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('proxy can short-circuit', async () => {
    const handler = createPipeline(
      makeConfig({
        proxy: async (_req, _next) => {
          return new Response('blocked', { status: 403 });
        },
        matchRoute: () => {
          throw new Error('should not be called');
        },
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('blocked');
  });

  it('proxy array — first item can short-circuit', async () => {
    const order: string[] = [];
    const a: ProxyFn = async (_req, _next) => {
      order.push('a');
      return new Response(null, { status: 204 });
    };
    const b: ProxyFn = async (_req, next) => {
      order.push('b');
      return next();
    };

    const handler = createPipeline(
      makeConfig({
        proxy: [a, b],
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(204);
    expect(order).toEqual(['a']);
  });

  it('proxy error 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = createPipeline(
      makeConfig({
        proxy: async () => {
          throw new Error('proxy crash');
        },
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(500);
    expect(res.body).toBeNull();

    errorSpy.mockRestore();
  });

  it('proxy can wrap response (timing headers)', async () => {
    const handler = createPipeline(
      makeConfig({
        proxy: async (_req, next) => {
          const start = Date.now();
          const res = await next();
          const headers = new Headers(res.headers);
          headers.set('X-Duration', String(Date.now() - start));
          return new Response(res.body, { status: res.status, headers });
        },
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(200);
    expect(res.headers.has('X-Duration')).toBe(true);
  });
});

// ─── runProxy (unit) ──────────────────────────────────────────────────────

describe('runProxy()', () => {
  it('function form calls next', async () => {
    const fn: ProxyFn = async (_req, next) => next();
    const res = await runProxy(fn, makeRequest('/'), async () => new Response('ok'));
    expect(await res.text()).toBe('ok');
  });

  it('array form composes left-to-right', async () => {
    const order: string[] = [];
    const a: ProxyFn = async (_req, next) => {
      order.push('a');
      return next();
    };
    const b: ProxyFn = async (_req, next) => {
      order.push('b');
      return next();
    };

    await runProxy([a, b], makeRequest('/'), async () => {
      order.push('next');
      return new Response('ok');
    });
    expect(order).toEqual(['a', 'b', 'next']);
  });

  it('empty array calls next directly', async () => {
    const res = await runProxy([], makeRequest('/'), async () => new Response('pass'));
    expect(await res.text()).toBe('pass');
  });
});

// ─── middleware.ts ─────────────────────────────────────────────────────────

describe('middleware.ts', () => {
  it('leaf middleware only', async () => {
    const middlewareFn: MiddlewareFn = async (ctx) => {
      ctx.headers.set('X-Custom', 'set');
    };

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
        render: (_req, _match, responseHeaders) => {
          return new Response('OK', {
            status: 200,
            headers: { 'X-Custom': responseHeaders.get('X-Custom') ?? '' },
          });
        },
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.headers.get('X-Custom')).toBe('set');
  });

  it('middleware short-circuit', async () => {
    const middlewareFn: MiddlewareFn = async () => {
      return new Response('redirect', { status: 302, headers: { Location: '/login' } });
    };

    const renderSpy = vi.fn(() => new Response('should not reach'));

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
        render: renderSpy,
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('middleware short-circuit with Response.redirect() (immutable headers)', async () => {
    // Response.redirect() creates a Response with immutable headers.
    // The pipeline must handle this without throwing when applying cookies
    // or Server-Timing headers.
    const middlewareFn: MiddlewareFn = async (ctx) => {
      return Response.redirect(new URL('/', new URL(ctx.req.url)), 302);
    };

    const renderSpy = vi.fn(() => new Response('should not reach'));

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
        render: renderSpy,
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('http://localhost/');
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('middleware throw 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const middlewareFn: MiddlewareFn = async () => {
      throw new Error('middleware crash');
    };

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(500);
    expect(res.body).toBeNull();

    errorSpy.mockRestore();
  });

  it('middleware context shape', async () => {
    let capturedCtx: MiddlewareContext | undefined;

    const middlewareFn: MiddlewareFn = async (ctx) => {
      capturedCtx = ctx;
    };

    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: middlewareFn,
            params: { id: '42' },
          }),
      })
    );

    await handler(makeRequest('/product/42?color=blue'));

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.req).toBeInstanceOf(Request);
    expect(capturedCtx!.params).toEqual({ id: '42' });
    expect(capturedCtx!.requestHeaders).toBeInstanceOf(Headers);
    expect(capturedCtx!.headers).toBeInstanceOf(Headers);
    expect(capturedCtx!.searchParams).toBeInstanceOf(URLSearchParams);
    expect((capturedCtx!.searchParams as URLSearchParams).get('color')).toBe('blue');
  });

  it('request headers overlay', async () => {
    const middlewareFn: MiddlewareFn = async (ctx) => {
      ctx.requestHeaders.set('X-Locale', 'en');
      ctx.requestHeaders.set('X-Feature', 'new-ui');
    };

    let receivedOverlay: Headers | undefined;

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
        render: (_req, _match, _responseHeaders, requestHeaderOverlay) => {
          receivedOverlay = requestHeaderOverlay;
          return new Response('OK');
        },
      })
    );

    const req = makeRequest('/test');
    await handler(req);

    // Overlay has the injected headers
    expect(receivedOverlay!.get('X-Locale')).toBe('en');
    expect(receivedOverlay!.get('X-Feature')).toBe('new-ui');

    // Original request is unchanged
    expect(req.headers.get('X-Locale')).toBeNull();
  });

  it('headers() returns middleware-injected request headers during render', async () => {
    const middlewareFn: MiddlewareFn = async (ctx) => {
      ctx.requestHeaders.set('X-Locale', 'fr');
    };

    let headersLocale: string | null = null;

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
        render: () => {
          // headers() should see the overlay header set by middleware
          headersLocale = headers().get('X-Locale');
          return new Response('OK');
        },
      })
    );

    await handler(makeRequest('/test'));
    expect(headersLocale).toBe('fr');
  });
});

// ─── runMiddleware (unit) ──────────────────────────────────────────────────

describe('runMiddleware()', () => {
  it('returns undefined when middleware returns void', async () => {
    const fn: MiddlewareFn = async () => {};
    const ctx: MiddlewareContext = {
      req: makeRequest('/'),
      requestHeaders: new Headers(),
      headers: new Headers(),
      params: {},
      searchParams: new URLSearchParams(),
      earlyHints: () => {},
    };
    const result = await runMiddleware(fn, ctx);
    expect(result).toBeUndefined();
  });

  it('returns Response when middleware returns one', async () => {
    const fn: MiddlewareFn = async () => new Response('denied', { status: 401 });
    const ctx: MiddlewareContext = {
      req: makeRequest('/'),
      requestHeaders: new Headers(),
      headers: new Headers(),
      params: {},
      searchParams: new URLSearchParams(),
      earlyHints: () => {},
    };
    const result = await runMiddleware(fn, ctx);
    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(401);
  });
});

// ─── URL canonicalization in pipeline ─────────────────────────────────────

describe('URL canonicalization in pipeline', () => {
  it('rejects encoded separators with 400', async () => {
    const handler = createPipeline(makeConfig());
    const res = await handler(makeRequest('/foo%2fbar'));
    expect(res.status).toBe(400);
  });

  it('rejects null bytes with 400', async () => {
    const handler = createPipeline(makeConfig());
    const res = await handler(makeRequest('/foo%00bar'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when no route matches', async () => {
    const handler = createPipeline(
      makeConfig({
        matchRoute: () => null,
      })
    );
    const res = await handler(makeRequest('/nonexistent'));
    expect(res.status).toBe(404);
  });

  it('passes canonical pathname to matcher', async () => {
    let receivedPath: string | undefined;

    const handler = createPipeline(
      makeConfig({
        matchRoute: (pathname) => {
          receivedPath = pathname;
          return makeMatch();
        },
      })
    );

    // Double slashes should be collapsed
    await handler(makeRequest('//foo///bar'));
    expect(receivedPath).toBe('/foo/bar');
  });

  it('trailing slash is stripped', async () => {
    let receivedPath: string | undefined;

    const handler = createPipeline(
      makeConfig({
        matchRoute: (pathname) => {
          receivedPath = pathname;
          return makeMatch();
        },
      })
    );

    await handler(makeRequest('/foo/bar/'));
    expect(receivedPath).toBe('/foo/bar');
  });
});

// ─── Full pipeline integration ────────────────────────────────────────────

describe('full pipeline', () => {
  it('proxy → canonicalize → match → middleware → render', async () => {
    const order: string[] = [];

    const handler = createPipeline({
      proxy: async (_req, next) => {
        order.push('proxy');
        return next();
      },
      matchRoute: () => {
        order.push('match');
        return makeMatch({
          middleware: async (ctx) => {
            order.push('middleware');
            ctx.headers.set('X-Via', 'pipeline');
          },
        });
      },
      render: (_req, _match, responseHeaders) => {
        order.push('render');
        return new Response('done', {
          status: 200,
          headers: { 'X-Via': responseHeaders.get('X-Via') ?? '' },
        });
      },
    });

    const res = await handler(makeRequest('/test'));
    expect(order).toEqual(['proxy', 'match', 'middleware', 'render']);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Via')).toBe('pipeline');
  });

  it('no proxy — pipeline works without proxy.ts', async () => {
    const handler = createPipeline(makeConfig());
    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(200);
  });

  it('early hints emitter called after match, before middleware', async () => {
    const order: string[] = [];

    const handler = createPipeline({
      matchRoute: () => {
        order.push('match');
        return makeMatch({
          middleware: async () => {
            order.push('middleware');
          },
        });
      },
      earlyHints: async () => {
        order.push('hints');
      },
      render: () => {
        order.push('render');
        return new Response('OK');
      },
    });

    await handler(makeRequest('/test'));
    expect(order).toEqual(['match', 'hints', 'middleware', 'render']);
  });

  it('early hints failure is non-fatal', async () => {
    const handler = createPipeline({
      matchRoute: () => makeMatch(),
      earlyHints: async () => {
        throw new Error('hints broken');
      },
      render: () => new Response('OK'),
    });

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(200);
  });
});

// ─── renderFallbackError ──────────────────────────────────────────────────

describe('renderFallbackError', () => {
  it('renders fallback error page when render throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = createPipeline(
      makeConfig({
        render: () => {
          throw new Error('catastrophic render failure');
        },
        renderFallbackError: (error) => {
          const msg = error instanceof Error ? error.message : 'Unknown';
          return new Response(`<h1>${msg}</h1>`, {
            status: 500,
            headers: { 'Content-Type': 'text/html' },
          });
        },
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toBe('text/html');
    const body = await res.text();
    expect(body).toContain('catastrophic render failure');

    errorSpy.mockRestore();
  });

  it('falls back to bare 500 when renderFallbackError itself throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = createPipeline(
      makeConfig({
        render: () => {
          throw new Error('render crash');
        },
        renderFallbackError: () => {
          throw new Error('fallback also crashed');
        },
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(500);
    expect(res.body).toBeNull();

    errorSpy.mockRestore();
  });

  it('still calls onPipelineError before renderFallbackError', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order: string[] = [];

    const handler = createPipeline(
      makeConfig({
        render: () => {
          throw new Error('boom');
        },
        onPipelineError: () => {
          order.push('onPipelineError');
        },
        renderFallbackError: () => {
          order.push('renderFallbackError');
          return new Response('error page', { status: 500 });
        },
      })
    );

    await handler(makeRequest('/test'));
    expect(order).toEqual(['onPipelineError', 'renderFallbackError']);

    errorSpy.mockRestore();
  });

  it('does not use renderFallbackError when render succeeds', async () => {
    const fallbackSpy = vi.fn(() => new Response('error', { status: 500 }));

    const handler = createPipeline(
      makeConfig({
        renderFallbackError: fallbackSpy,
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(200);
    expect(fallbackSpy).not.toHaveBeenCalled();
  });
});

// ─── Production Server-Timing ─────────────────────────────────────────────

describe('production Server-Timing header', () => {
  it('emits total duration when enableServerTiming is false', async () => {
    const handler = createPipeline(
      makeConfig({
        enableServerTiming: false,
      })
    );

    const res = await handler(makeRequest('/test'));
    const timing = res.headers.get('Server-Timing');
    expect(timing).toBeTruthy();
    // Should be just "total;dur=N" — no phase breakdown
    expect(timing).toMatch(/^total;dur=\d+$/);
  });

  it('emits detailed timing when enableServerTiming is true', async () => {
    const handler = createPipeline(
      makeConfig({
        enableServerTiming: true,
      })
    );

    const res = await handler(makeRequest('/test'));
    const timing = res.headers.get('Server-Timing');
    expect(timing).toBeTruthy();
    // Dev mode includes named phases like "render"
    expect(timing).toContain('render;dur=');
  });

  it('production total;dur is non-negative', async () => {
    const handler = createPipeline(
      makeConfig({
        enableServerTiming: false,
      })
    );

    const res = await handler(makeRequest('/test'));
    const timing = res.headers.get('Server-Timing')!;
    const match = timing.match(/total;dur=(\d+)/);
    expect(match).toBeTruthy();
    expect(Number(match![1])).toBeGreaterThanOrEqual(0);
  });
});
