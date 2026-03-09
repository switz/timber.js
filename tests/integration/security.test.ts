/**
 * Phase 1 Integration Tests — Security
 *
 * Tests security-critical behaviors from design/13-security.md checklist:
 *   URL canonicalization, CSRF, redirect safety, error leakage.
 *
 * Each test references the specific checklist item it validates.
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
import type { ProxyFn } from '../../packages/timber-app/src/server/proxy';
import { validateCsrf } from '../../packages/timber-app/src/server/csrf';
import { canonicalize } from '../../packages/timber-app/src/server/canonicalize';
import {
  redirect,
  redirectExternal,
  RenderError,
  RedirectSignal,
} from '../../packages/timber-app/src/server/primitives';
import type { SegmentNode, RouteFile } from '../../packages/timber-app/src/routing/types';
import { resolveSlotDenied } from '../../packages/timber-app/src/server/status-code-resolver';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

function makeMatch(overrides?: Partial<RouteMatch>): RouteMatch {
  return { segments: [], params: {}, ...overrides };
}

function okRender(): RouteRenderer {
  return () => new Response('OK', { status: 200 });
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

// ─── Slot Deny Isolation ─────────────────────────────────────────────────

describe('slot deny isolation', () => {
  it('denied slot resolves denied.tsx while siblings are unaffected', () => {
    const adminSlot = makeSegment({
      segmentName: '@admin',
      segmentType: 'slot',
      urlPath: '/',
      denied: makeRouteFile('app/@admin/denied.tsx'),
    });

    const sidebarSlot = makeSegment({
      segmentName: '@sidebar',
      segmentType: 'slot',
      urlPath: '/',
      page: makeRouteFile('app/@sidebar/page.tsx'),
    });

    const adminResult = resolveSlotDenied(adminSlot);
    expect(adminResult).not.toBeNull();
    expect(adminResult!.file.filePath).toBe('app/@admin/denied.tsx');
    expect(adminResult!.slotName).toBe('admin');

    const sidebarResult = resolveSlotDenied(sidebarSlot);
    expect(sidebarResult).toBeNull();
  });

  it('slot deny falls back to default.tsx when no denied.tsx exists', () => {
    const slot = makeSegment({
      segmentName: '@panel',
      segmentType: 'slot',
      urlPath: '/',
      default: makeRouteFile('app/@panel/default.tsx'),
    });

    const result = resolveSlotDenied(slot);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/@panel/default.tsx');
    expect(result!.kind).toBe('default');
  });

  it('slot deny with no denied.tsx and no default.tsx returns null', () => {
    const slot = makeSegment({
      segmentName: '@empty',
      segmentType: 'slot',
      urlPath: '/',
    });

    const result = resolveSlotDenied(slot);
    expect(result).toBeNull();
  });
});

// ─── URL Canonicalization ────────────────────────────────────────────────
// Security checklist items 1–4 from design/13-security.md

describe('url canonicalization', () => {
  it('rejects encoded separators %2f with 400 (security #2)', async () => {
    const handler = createPipeline(makeConfig());
    const res = await handler(makeRequest('/foo%2fbar'));
    expect(res.status).toBe(400);
  });

  it('rejects encoded backslash %5c with 400 (security #2)', async () => {
    const handler = createPipeline(makeConfig());
    const res = await handler(makeRequest('/foo%5cbar'));
    expect(res.status).toBe(400);
  });

  it('rejects null bytes %00 with 400 (security #3)', async () => {
    const handler = createPipeline(makeConfig());
    const res = await handler(makeRequest('/foo%00bar'));
    expect(res.status).toBe(400);
  });

  it('double-encoded %2561 decodes once to %61, not to /admin (security #1)', () => {
    // %2561 → single decode → %61 (the %25 decodes to %, giving %61)
    // It should NOT decode again to 'a'
    const result = canonicalize('/%2561dmin');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pathname).not.toBe('/admin');
    }
  });

  it('path traversal with encoded separator is rejected (security #2)', async () => {
    const handler = createPipeline(makeConfig());
    const res = await handler(makeRequest('/foo/..%2fadmin'));
    expect(res.status).toBe(400);
  });

  it('.. escaping root is rejected with 400', () => {
    const result = canonicalize('/../../../etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('consecutive slashes are collapsed', () => {
    const result = canonicalize('//foo///bar');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pathname).toBe('/foo/bar');
  });

  it('trailing slash is stripped (except root)', () => {
    const result = canonicalize('/foo/bar/');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pathname).toBe('/foo/bar');
  });

  it('root path is preserved as /', () => {
    const result = canonicalize('/');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pathname).toBe('/');
  });

  it('backslash is NOT treated as path separator (security #4)', () => {
    const result = canonicalize('/\\evil.com');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pathname).not.toBe('//evil.com');
      expect(result.pathname).toBe('/\\evil.com');
    }
  });
});

// ─── CSRF Protection ────────────────────────────────────────────────────
// Security checklist item 6 from design/13-security.md

describe('csrf protection', () => {
  it('blocks cross-origin POST with 403 (security #6)', () => {
    const req = makeRequest('/action', {
      method: 'POST',
      headers: { Host: 'example.com', Origin: 'https://evil.com' },
    });
    const result = validateCsrf(req, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it('blocks POST without Origin header (security #6)', () => {
    const req = makeRequest('/action', {
      method: 'POST',
      headers: { Host: 'example.com' },
    });
    const result = validateCsrf(req, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it('allows same-origin POST', () => {
    const req = makeRequest('/action', {
      method: 'POST',
      headers: { Host: 'example.com', Origin: 'https://example.com' },
    });
    const result = validateCsrf(req, {});
    expect(result.ok).toBe(true);
  });

  it('allows GET without Origin (safe method)', () => {
    const req = makeRequest('/page', {
      method: 'GET',
      headers: { Host: 'example.com' },
    });
    const result = validateCsrf(req, {});
    expect(result.ok).toBe(true);
  });

  it('blocks cross-origin PUT, PATCH, DELETE', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const req = makeRequest('/api/resource', {
        method,
        headers: { Host: 'example.com', Origin: 'https://evil.com' },
      });
      const result = validateCsrf(req, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(403);
    }
  });

  it('CSRF integrated in pipeline: proxy rejects cross-origin POST before render', async () => {
    const proxyWithCsrf: ProxyFn = async (req, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const csrf = validateCsrf(req, {});
        if (!csrf.ok) {
          return new Response(null, { status: csrf.status });
        }
      }
      return next();
    };

    const handler = createPipeline({
      proxy: proxyWithCsrf,
      matchRoute: () => makeMatch(),
      render: okRender(),
    });

    const res = await handler(
      makeRequest('/action', {
        method: 'POST',
        headers: { Host: 'example.com', Origin: 'https://evil.com' },
      })
    );
    expect(res.status).toBe(403);
  });
});

// ─── Redirect Absolute Rejection ─────────────────────────────────────────
// Security checklist items 7–8 from design/13-security.md

describe('redirect absolute rejection', () => {
  it('redirect() rejects absolute URLs (security #7)', () => {
    expect(() => redirect('https://evil.com')).toThrow(/absolute/i);
  });

  it('redirect() rejects protocol-relative URLs (security #8)', () => {
    expect(() => redirect('//evil.com')).toThrow(/absolute/i);
  });

  it('redirect() rejects javascript: scheme', () => {
    expect(() => redirect('javascript:alert(1)' as string)).toThrow();
  });

  it('redirect() rejects data: scheme', () => {
    expect(() => redirect('data:text/html,<h1>hi</h1>' as string)).toThrow();
  });

  it('redirect() accepts relative paths', () => {
    try {
      redirect('/login');
    } catch (e) {
      expect(e).toBeInstanceOf(RedirectSignal);
      expect((e as RedirectSignal).location).toBe('/login');
    }
  });

  it('redirectExternal() rejects URLs not in allow-list (security #7)', () => {
    expect(() => redirectExternal('https://evil.com', ['example.com'])).toThrow(/not in the allow/);
  });

  it('redirectExternal() accepts URLs in allow-list', () => {
    try {
      redirectExternal('https://example.com/callback', ['example.com']);
    } catch (e) {
      expect(e).toBeInstanceOf(RedirectSignal);
      expect((e as RedirectSignal).location).toBe('https://example.com/callback');
    }
  });
});

// ─── Error Leakage Prevention (security #13) ─────────────────────────────

describe('error leakage prevention', () => {
  it('RenderError does not expose internal message to client digest', () => {
    const err = new RenderError('INTERNAL_ERROR', {});
    expect(err.digest.code).toBe('INTERNAL_ERROR');
    expect(err.digest.data).toEqual({});
    expect(err.message).toContain('INTERNAL_ERROR');
  });

  it('unexpected throw in middleware produces bare 500 with no body', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = createPipeline(
      makeConfig({
        matchRoute: () =>
          makeMatch({
            middleware: async () => {
              throw new Error('secret database credentials');
            },
          }),
      })
    );

    const res = await handler(makeRequest('/page'));
    expect(res.status).toBe(500);
    expect(res.body).toBeNull();
    errorSpy.mockRestore();
  });
});
