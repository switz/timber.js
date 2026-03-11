import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  warnSuspenseWrappingChildren,
  warnDenyInSuspense,
  warnRedirectInSuspense,
  warnRedirectInAccess,
  warnStaticRequestApi,
  warnCacheRequestProps,
  warnSlowSlotWithoutSuspense,
  setViteServer,
  _resetWarnings,
  _getEmitted,
  WarningId,
} from '../packages/timber-app/src/server/dev-warnings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  _resetWarnings();
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  setViteServer(null);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

// ─── SUSPENSE_WRAPS_CHILDREN ────────────────────────────────────────────────

describe('SUSPENSE_WRAPS_CHILDREN', () => {
  it('warns on Suspense wrapping children', () => {
    warnSuspenseWrappingChildren('app/(dashboard)/layout.tsx');

    expect(stderrSpy).toHaveBeenCalledOnce();
    const msg = stderrSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('Suspense');
    expect(msg).toContain('{children}');
    expect(msg).toContain('app/(dashboard)/layout.tsx');
    expect(msg).toContain('useNavigationPending()');
  });
});

// ─── DENY_IN_SUSPENSE ──────────────────────────────────────────────────────

describe('DENY_IN_SUSPENSE', () => {
  it('warns on deny in Suspense', () => {
    warnDenyInSuspense('app/dashboard/page.tsx', 42);

    expect(stderrSpy).toHaveBeenCalledOnce();
    const msg = stderrSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('deny()');
    expect(msg).toContain('Suspense');
    expect(msg).toContain('app/dashboard/page.tsx:42');
    expect(msg).toContain('HTTP status');
  });
});

// ─── REDIRECT_IN_SUSPENSE ──────────────────────────────────────────────────

describe('REDIRECT_IN_SUSPENSE', () => {
  it('warns on redirect in Suspense', () => {
    warnRedirectInSuspense('app/dashboard/page.tsx', 55);

    expect(stderrSpy).toHaveBeenCalledOnce();
    const msg = stderrSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('redirect()');
    expect(msg).toContain('Suspense');
    expect(msg).toContain('app/dashboard/page.tsx:55');
    expect(msg).toContain('client-side navigation');
  });
});

// ─── REDIRECT_IN_ACCESS ────────────────────────────────────────────────────

describe('REDIRECT_IN_ACCESS', () => {
  it('warns on redirect in access', () => {
    warnRedirectInAccess('app/admin/access.ts', 12);

    expect(stderrSpy).toHaveBeenCalledOnce();
    const msg = stderrSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('redirect()');
    expect(msg).toContain('access.ts');
    expect(msg).toContain('app/admin/access.ts:12');
    expect(msg).toContain('deny()');
    expect(msg).toContain('middleware.ts');
  });
});

// ─── STATIC_REQUEST_API ────────────────────────────────────────────────────

describe('STATIC_REQUEST_API', () => {
  it('warns on dynamic API in static', () => {
    warnStaticRequestApi('cookies', '/about');

    expect(stderrSpy).toHaveBeenCalledOnce();
    const msg = stderrSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('cookies()');
    expect(msg).toContain('static');
    expect(msg).toContain('/about');
  });

  it('warns for headers() in static build', () => {
    warnStaticRequestApi('headers', '/contact');

    expect(stderrSpy).toHaveBeenCalledOnce();
    const msg = stderrSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('headers()');
  });
});

// ─── CACHE_REQUEST_PROPS ───────────────────────────────────────────────────

describe('CACHE_REQUEST_PROPS', () => {
  it('warns on cache request props', () => {
    warnCacheRequestProps('UserGreeting', 'userId', 'app/components/greeting.tsx', 15);

    expect(stderrSpy).toHaveBeenCalledOnce();
    const msg = stderrSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('UserGreeting');
    expect(msg).toContain('"userId"');
    expect(msg).toContain('request-specific');
    expect(msg).toContain('Cached component');
  });
});

// ─── SLOW_SLOT_NO_SUSPENSE ─────────────────────────────────────────────────

describe('SLOW_SLOT_NO_SUSPENSE', () => {
  it('warns on slow slot', () => {
    warnSlowSlotWithoutSuspense('@admin', 847);

    expect(stderrSpy).toHaveBeenCalledOnce();
    const msg = stderrSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('@admin');
    expect(msg).toContain('847ms');
    expect(msg).toContain('Suspense');
    expect(msg).toContain('blocking the flush');
  });
});

// ─── Production stripping ───────────────────────────────────────────────

describe('production stripping', () => {
  it('no production warnings', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      warnSuspenseWrappingChildren('app/layout.tsx');

      warnDenyInSuspense('app/page.tsx', 10);
      warnRedirectInSuspense('app/page.tsx', 20);
      warnRedirectInAccess('app/access.ts', 5);
      warnStaticRequestApi('cookies', '/about');
      warnCacheRequestProps('Foo', 'bar', 'app/foo.tsx');
      warnSlowSlotWithoutSuspense('@feed', 500);

      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

// ─── Deduplication ──────────────────────────────────────────────────────

describe('deduplication', () => {
  it('does not repeat the same warning for the same file:line', () => {
    warnDenyInSuspense('app/page.tsx', 42);
    warnDenyInSuspense('app/page.tsx', 42);
    warnDenyInSuspense('app/page.tsx', 42);

    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('warns for different locations', () => {
    warnDenyInSuspense('app/page.tsx', 42);
    warnDenyInSuspense('app/page.tsx', 55);

    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it('warns for different files', () => {
    warnSuspenseWrappingChildren('app/layout.tsx');
    warnSuspenseWrappingChildren('app/(dashboard)/layout.tsx');

    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it('dedup key includes warningId and location', () => {
    warnDenyInSuspense('app/page.tsx', 42);

    const emitted = _getEmitted();
    expect(emitted.has(`${WarningId.DENY_IN_SUSPENSE}:app/page.tsx:42`)).toBe(true);
  });
});

// ─── stderr output ─────────────────────────────────────────────────────

describe('stderr output', () => {
  it('writes to stderr, not stdout', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      warnSuspenseWrappingChildren('app/layout.tsx');

      expect(stderrSpy).toHaveBeenCalledOnce();
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});

// ─── Browser console forwarding ────────────────────────────────────────

describe('browser console forwarding', () => {
  it('forwards warnings via Vite WebSocket when server is set', () => {
    const hotSend = vi.fn();
    const fakeServer = { hot: { send: hotSend } } as unknown as import('vite').ViteDevServer;
    setViteServer(fakeServer);

    warnSuspenseWrappingChildren('app/layout.tsx');

    expect(hotSend).toHaveBeenCalledOnce();
    expect(hotSend).toHaveBeenCalledWith('timber:dev-warning', {
      warningId: WarningId.SUSPENSE_WRAPS_CHILDREN,
      level: 'warn',
      message: expect.stringContaining('[timber]'),
    });
  });

  it('does not forward when no server is set', () => {
    setViteServer(null);
    warnSuspenseWrappingChildren('app/layout.tsx');

    // Should not throw — just writes to stderr
    expect(stderrSpy).toHaveBeenCalledOnce();
  });
});
