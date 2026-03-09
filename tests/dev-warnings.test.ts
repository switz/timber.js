import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  warnSuspenseWrappingChildren,
  warnDeferredSuspenseWrappingChildren,
  warnDynamicApiInStaticBuild,
  warnRedirectInSlotAccess,
  warnDenyAfterFlush,
  warnSlowSlotWithoutSuspense,
  _resetWarnings,
} from '../packages/timber-app/src/server/dev-warnings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  _resetWarnings();
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

// ─── Suspense wrapping {children} in layout ────────────────────────────────

describe('warnSuspenseWrappingChildren', () => {
  it('suspense children warn', () => {
    warnSuspenseWrappingChildren('app/(dashboard)/layout.tsx');

    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('[timber]');
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('Suspense');
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('{children}');
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('app/(dashboard)/layout.tsx');
  });

  it('warns about DeferredSuspense wrapping children', () => {
    warnDeferredSuspenseWrappingChildren('app/layout.tsx');

    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('DeferredSuspense');
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('{children}');
  });
});

// ─── cookies()/headers() in static build ─────────────────────────────────

describe('warnDynamicApiInStaticBuild', () => {
  it('static dynamic api warn', () => {
    warnDynamicApiInStaticBuild('cookies', 'app/page.tsx');

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('[timber]');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('cookies()');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('static');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('app/page.tsx');
  });

  it('warns for headers() in static build', () => {
    warnDynamicApiInStaticBuild('headers', 'app/access.ts');

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('headers()');
  });
});

// ─── redirect() in slot access ──────────────────────────────────────────

describe('warnRedirectInSlotAccess', () => {
  it('slot redirect warn', () => {
    warnRedirectInSlotAccess('@admin');

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('[timber]');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('redirect()');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('slot');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('@admin');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('deny()');
  });
});

// ─── deny()/redirect() in post-flush Suspense ───────────────────────────

describe('warnDenyAfterFlush', () => {
  it('warns when deny() is called inside post-flush Suspense', () => {
    warnDenyAfterFlush('deny');

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('[timber]');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('deny()');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('Suspense');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('status code');
  });

  it('warns when redirect() is called inside post-flush Suspense', () => {
    warnDenyAfterFlush('redirect');

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('redirect()');
  });
});

// ─── Slow slot without Suspense ─────────────────────────────────────────

describe('warnSlowSlotWithoutSuspense', () => {
  it('slow slot warn', () => {
    warnSlowSlotWithoutSuspense('@admin', 847);

    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('[timber]');
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('@admin');
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('847ms');
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('Suspense');
  });

  it('includes resolution time and advice', () => {
    warnSlowSlotWithoutSuspense('@feed', 320);

    const msg = consoleWarnSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('320ms');
    expect(msg).toContain('wrapping');
  });
});

// ─── Production stripping ───────────────────────────────────────────────

describe('production stripping', () => {
  // The warning functions check process.env.NODE_ENV internally.
  // In production, they should be no-ops.

  it('no production warnings', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      warnSuspenseWrappingChildren('app/layout.tsx');
      warnDeferredSuspenseWrappingChildren('app/layout.tsx');
      warnDynamicApiInStaticBuild('cookies', 'app/page.tsx');
      warnRedirectInSlotAccess('@admin');
      warnDenyAfterFlush('deny');
      warnSlowSlotWithoutSuspense('@feed', 500);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

// ─── Deduplication ──────────────────────────────────────────────────────

describe('deduplication', () => {
  it('does not repeat the same warning for the same location', () => {
    warnSuspenseWrappingChildren('app/layout.tsx');
    warnSuspenseWrappingChildren('app/layout.tsx');
    warnSuspenseWrappingChildren('app/layout.tsx');

    // Should only warn once for the same file
    expect(consoleWarnSpy).toHaveBeenCalledOnce();
  });

  it('warns for different locations', () => {
    warnSuspenseWrappingChildren('app/layout.tsx');
    warnSuspenseWrappingChildren('app/(dashboard)/layout.tsx');

    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
  });
});
