import { describe, it, expect, vi } from 'vitest';
import {
  createRedirectMatcher,
  type RedirectMatch,
} from '../packages/timber-app/src/server/redirects';
import { createPipeline } from '../packages/timber-app/src/server/pipeline';
import type { RouteMatch } from '../packages/timber-app/src/server/pipeline';

// ---------------------------------------------------------------------------
// createRedirectMatcher — unit tests
// ---------------------------------------------------------------------------

describe('createRedirectMatcher', () => {
  describe('redirects', () => {
    it('static path redirect', () => {
      const match = createRedirectMatcher([{ source: '/old', destination: '/new' }], []);

      const result = match('/old');
      expect(result).toEqual({
        type: 'redirect',
        destination: '/new',
        status: 307,
      });
    });

    it('permanent redirect uses 308', () => {
      const match = createRedirectMatcher(
        [{ source: '/old', destination: '/new', permanent: true }],
        []
      );

      const result = match('/old');
      expect(result).toEqual({
        type: 'redirect',
        destination: '/new',
        status: 308,
      });
    });

    it('temporary redirect uses 307', () => {
      const match = createRedirectMatcher(
        [{ source: '/old', destination: '/new', permanent: false }],
        []
      );

      const result = match('/old') as RedirectMatch;
      expect(result.status).toBe(307);
    });

    it('redirect with :param placeholder', () => {
      const match = createRedirectMatcher(
        [{ source: '/old/:slug', destination: '/new/:slug' }],
        []
      );

      const result = match('/old/hello-world');
      expect(result).toEqual({
        type: 'redirect',
        destination: '/new/hello-world',
        status: 307,
      });
    });

    it('redirect with multiple :params', () => {
      const match = createRedirectMatcher(
        [{ source: '/blog/:year/:slug', destination: '/posts/:year/:slug' }],
        []
      );

      const result = match('/blog/2024/my-post');
      expect(result).toEqual({
        type: 'redirect',
        destination: '/posts/2024/my-post',
        status: 307,
      });
    });

    it('redirect with catch-all :param*', () => {
      const match = createRedirectMatcher(
        [{ source: '/docs/:path*', destination: '/documentation/:path*' }],
        []
      );

      const result = match('/docs/guides/getting-started');
      expect(result).toEqual({
        type: 'redirect',
        destination: '/documentation/guides/getting-started',
        status: 307,
      });
    });

    it('no match returns null', () => {
      const match = createRedirectMatcher([{ source: '/old', destination: '/new' }], []);

      expect(match('/other')).toBeNull();
      expect(match('/old/nested')).toBeNull();
    });

    it('first matching rule wins', () => {
      const match = createRedirectMatcher(
        [
          { source: '/a', destination: '/first' },
          { source: '/a', destination: '/second' },
        ],
        []
      );

      const result = match('/a') as RedirectMatch;
      expect(result.destination).toBe('/first');
    });

    it('does not match partial paths', () => {
      const match = createRedirectMatcher([{ source: '/old', destination: '/new' }], []);

      expect(match('/old/extra')).toBeNull();
      expect(match('/prefix/old')).toBeNull();
    });
  });

  describe('rewrites', () => {
    it('static path rewrite', () => {
      const match = createRedirectMatcher([], [{ source: '/api', destination: '/api/v2' }]);

      const result = match('/api');
      expect(result).toEqual({
        type: 'rewrite',
        destination: '/api/v2',
      });
    });

    it('rewrite with :param placeholder', () => {
      const match = createRedirectMatcher(
        [],
        [{ source: '/users/:id', destination: '/api/users/:id' }]
      );

      const result = match('/users/42');
      expect(result).toEqual({
        type: 'rewrite',
        destination: '/api/users/42',
      });
    });

    it('rewrite with catch-all', () => {
      const match = createRedirectMatcher(
        [],
        [{ source: '/proxy/:path*', destination: '/api/proxy/:path*' }]
      );

      const result = match('/proxy/v1/users/list');
      expect(result).toEqual({
        type: 'rewrite',
        destination: '/api/proxy/v1/users/list',
      });
    });
  });

  describe('priority', () => {
    it('redirects take priority over rewrites', () => {
      const match = createRedirectMatcher(
        [{ source: '/old', destination: '/redirect-target' }],
        [{ source: '/old', destination: '/rewrite-target' }]
      );

      const result = match('/old');
      expect(result?.type).toBe('redirect');
      expect((result as RedirectMatch).destination).toBe('/redirect-target');
    });
  });

  describe('edge cases', () => {
    it('root path redirect', () => {
      const match = createRedirectMatcher([{ source: '/', destination: '/home' }], []);

      const result = match('/');
      expect(result).toEqual({
        type: 'redirect',
        destination: '/home',
        status: 307,
      });
    });

    it('empty rules returns null for everything', () => {
      const match = createRedirectMatcher([], []);
      expect(match('/')).toBeNull();
      expect(match('/anything')).toBeNull();
    });

    it('special regex chars in static segments are escaped', () => {
      const match = createRedirectMatcher([{ source: '/old.page', destination: '/new' }], []);

      // The . should not match any character
      expect(match('/old.page')).not.toBeNull();
      expect(match('/oldXpage')).toBeNull();
    });

    it('param value with special characters', () => {
      const match = createRedirectMatcher(
        [{ source: '/user/:name', destination: '/profile/:name' }],
        []
      );

      const result = match('/user/john.doe') as RedirectMatch;
      expect(result.destination).toBe('/profile/john.doe');
    });
  });
});

// ---------------------------------------------------------------------------
// Pipeline integration — redirects run before route matching
// ---------------------------------------------------------------------------

describe('pipeline redirect integration', () => {
  function makePipeline(opts: {
    redirects?: { source: string; destination: string; permanent?: boolean }[];
    rewrites?: { source: string; destination: string }[];
  }) {
    const renderSpy = vi.fn(async (_req: Request, match: RouteMatch) => {
      return new Response(`rendered:${JSON.stringify(match.params)}`, { status: 200 });
    });

    const handler = createPipeline({
      matchRoute: (pathname) => {
        // Simple matcher: /new/:id or /target
        if (pathname === '/target') {
          return { segments: [], params: {}, middleware: undefined };
        }
        const dynamicMatch = pathname.match(/^\/new\/(.+)$/);
        if (dynamicMatch) {
          return { segments: [], params: { id: dynamicMatch[1] } } as RouteMatch;
        }
        return null;
      },
      render: renderSpy,
      redirects: opts.redirects,
      rewrites: opts.rewrites,
    });

    return { handler, renderSpy };
  }

  it('config redirect returns 307 with Location header', async () => {
    const { handler } = makePipeline({
      redirects: [{ source: '/old/:id', destination: '/new/:id' }],
    });

    const res = await handler(new Request('http://localhost/old/42'));

    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toBe('/new/42');
  });

  it('config permanent redirect returns 308', async () => {
    const { handler } = makePipeline({
      redirects: [{ source: '/old', destination: '/new/default', permanent: true }],
    });

    const res = await handler(new Request('http://localhost/old'));

    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('/new/default');
  });

  it('config rewrite transparently changes pathname for route matching', async () => {
    const { handler, renderSpy } = makePipeline({
      rewrites: [{ source: '/legacy', destination: '/target' }],
    });

    const res = await handler(new Request('http://localhost/legacy'));

    expect(res.status).toBe(200);
    expect(renderSpy).toHaveBeenCalled();
  });

  it('no redirect/rewrite match falls through to route matching', async () => {
    const { handler, renderSpy } = makePipeline({
      redirects: [{ source: '/old', destination: '/new/default' }],
    });

    const res = await handler(new Request('http://localhost/new/42'));

    expect(res.status).toBe(200);
    expect(renderSpy).toHaveBeenCalled();
  });

  it('redirect runs after canonicalization', async () => {
    const { handler } = makePipeline({
      redirects: [{ source: '/old', destination: '/new/default' }],
    });

    // Trailing slash should be stripped by canonicalization before redirect matching
    const res = await handler(new Request('http://localhost/old/'));

    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toBe('/new/default');
  });

  it('redirect runs before middleware', async () => {
    // Redirected requests should never reach route matching or middleware
    const { handler, renderSpy } = makePipeline({
      redirects: [{ source: '/redirected', destination: '/target' }],
    });

    const res = await handler(new Request('http://localhost/redirected'));

    expect(res.status).toBe(307);
    expect(renderSpy).not.toHaveBeenCalled();
  });
});
