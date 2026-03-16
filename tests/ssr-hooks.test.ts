/**
 * Tests for client hooks' SSR behavior.
 *
 * Verifies that hooks return correct request data during server-side rendering
 * via the SSR data context (setSsrData/getSsrData), instead of client-only defaults.
 *
 * These are unit tests for the hook logic — full integration with React
 * renderToReadableStream is tested in e2e tests.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  setSsrData,
  clearSsrData,
  getSsrData,
  registerSsrDataProvider,
  type SsrData,
} from '../packages/timber-app/src/client/ssr-data';

/** Helper to create SsrData with defaults. */
function makeSsrData(overrides: Partial<SsrData> = {}): SsrData {
  return {
    pathname: '/',
    searchParams: {},
    cookies: new Map(),
    params: {},
    ...overrides,
  };
}

// ─── SSR Data ────────────────────────────────────────────────────

describe('setSsrData / getSsrData / clearSsrData', () => {
  afterEach(() => {
    clearSsrData();
  });

  it('provides pathname after setSsrData', () => {
    setSsrData(makeSsrData({ pathname: '/dashboard/settings' }));
    expect(getSsrData()?.pathname).toBe('/dashboard/settings');
  });

  it('provides search params after setSsrData', () => {
    setSsrData(makeSsrData({ searchParams: { page: '2', sort: 'name' } }));
    expect(getSsrData()?.searchParams).toEqual({ page: '2', sort: 'name' });
  });

  it('provides cookies after setSsrData', () => {
    const cookies = new Map([['session', 'abc123']]);
    setSsrData(makeSsrData({ cookies }));
    expect(getSsrData()?.cookies.get('session')).toBe('abc123');
  });

  it('provides params after setSsrData', () => {
    setSsrData(makeSsrData({ params: { id: '42', slug: 'hello' } }));
    expect(getSsrData()?.params).toEqual({ id: '42', slug: 'hello' });
  });

  it('returns undefined before setSsrData is called', () => {
    expect(getSsrData()).toBeUndefined();
  });

  it('returns undefined after clearSsrData', () => {
    setSsrData(makeSsrData({ pathname: '/test' }));
    clearSsrData();
    expect(getSsrData()).toBeUndefined();
  });

  it('overwrites data on subsequent setSsrData calls', () => {
    setSsrData(makeSsrData({ pathname: '/a' }));
    expect(getSsrData()?.pathname).toBe('/a');

    setSsrData(makeSsrData({ pathname: '/b' }));
    expect(getSsrData()?.pathname).toBe('/b');
  });
});

// ─── ALS-Backed Provider ─────────────────────────────────────────

describe('registerSsrDataProvider (ALS-backed)', () => {
  const als = new AsyncLocalStorage<SsrData>();

  afterEach(() => {
    // Reset to no provider (module-level fallback)
    registerSsrDataProvider(undefined as never);
    clearSsrData();
  });

  it('getSsrData reads from ALS provider when registered', () => {
    registerSsrDataProvider(() => als.getStore());

    const data = makeSsrData({ pathname: '/als-test', params: { id: '1' } });
    als.run(data, () => {
      expect(getSsrData()?.pathname).toBe('/als-test');
      expect(getSsrData()?.params).toEqual({ id: '1' });
    });
  });

  it('ALS provider takes precedence over module-level state', () => {
    registerSsrDataProvider(() => als.getStore());

    // Set module-level state
    setSsrData(makeSsrData({ pathname: '/module-level' }));

    // ALS scope should win
    const alsData = makeSsrData({ pathname: '/als-scope' });
    als.run(alsData, () => {
      expect(getSsrData()?.pathname).toBe('/als-scope');
    });
  });

  it('returns undefined outside ALS scope when provider is registered', () => {
    registerSsrDataProvider(() => als.getStore());
    expect(getSsrData()).toBeUndefined();
  });

  it('concurrent ALS scopes are isolated', async () => {
    registerSsrDataProvider(() => als.getStore());

    const results: string[] = [];

    const requestA = als.run(
      makeSsrData({ pathname: '/request-a', params: { id: 'a' } }),
      async () => {
        // Simulate async work (Suspense resolution)
        await new Promise((r) => setTimeout(r, 10));
        results.push(`a:${getSsrData()?.pathname}`);
        return getSsrData()?.params;
      }
    );

    const requestB = als.run(
      makeSsrData({ pathname: '/request-b', params: { id: 'b' } }),
      async () => {
        // Simulate async work (Suspense resolution)
        await new Promise((r) => setTimeout(r, 5));
        results.push(`b:${getSsrData()?.pathname}`);
        return getSsrData()?.params;
      }
    );

    const [paramsA, paramsB] = await Promise.all([requestA, requestB]);

    // Each request sees its own data, not the other's
    expect(paramsA).toEqual({ id: 'a' });
    expect(paramsB).toEqual({ id: 'b' });
    expect(results).toContain('a:/request-a');
    expect(results).toContain('b:/request-b');
  });
});

// ─── parseCookiesFromHeader ──────────────────────────────────────

describe('parseCookiesFromHeader', () => {
  let parseCookiesFromHeader: (header: string) => Map<string, string>;

  beforeAll(async () => {
    const mod = await import('../packages/timber-app/src/server/rsc-entry/helpers');
    parseCookiesFromHeader = mod.parseCookiesFromHeader;
  });

  it('parses a simple cookie header', () => {
    const result = parseCookiesFromHeader('theme=dark; locale=en');
    expect(result.get('theme')).toBe('dark');
    expect(result.get('locale')).toBe('en');
    expect(result.size).toBe(2);
  });

  it('returns empty map for empty string', () => {
    expect(parseCookiesFromHeader('').size).toBe(0);
  });

  it('handles cookies with = in values', () => {
    const result = parseCookiesFromHeader('token=abc=def');
    expect(result.get('token')).toBe('abc=def');
  });

  it('trims whitespace around names and values', () => {
    const result = parseCookiesFromHeader('  name  =  value  ');
    expect(result.get('name')).toBe('value');
  });
});

// ─── usePathname SSR snapshot ────────────────────────────────────

describe('usePathname SSR data', () => {
  afterEach(() => {
    clearSsrData();
  });

  it('getSsrData provides pathname for server snapshot', () => {
    setSsrData(makeSsrData({ pathname: '/products/123' }));
    expect(getSsrData()?.pathname).toBe('/products/123');
  });

  it('returns undefined pathname outside SSR scope (falls back to /)', () => {
    expect(getSsrData()?.pathname).toBeUndefined();
  });
});

// ─── useSearchParams SSR snapshot ────────────────────────────────

describe('useSearchParams SSR data', () => {
  afterEach(() => {
    clearSsrData();
  });

  it('getSsrData provides search params for server snapshot', () => {
    setSsrData(makeSsrData({ searchParams: { q: 'test', page: '1' } }));
    expect(getSsrData()?.searchParams).toEqual({ q: 'test', page: '1' });
  });

  it('returns undefined search params outside SSR scope', () => {
    expect(getSsrData()?.searchParams).toBeUndefined();
  });
});

// ─── useCookie SSR snapshot ──────────────────────────────────────

describe('useCookie SSR data', () => {
  afterEach(() => {
    clearSsrData();
  });

  it('getSsrData provides cookies for server snapshot', () => {
    const cookies = new Map([
      ['theme', 'dark'],
      ['locale', 'en'],
    ]);
    setSsrData(makeSsrData({ cookies }));
    expect(getSsrData()?.cookies.get('theme')).toBe('dark');
    expect(getSsrData()?.cookies.get('locale')).toBe('en');
  });

  it('returns undefined for missing cookies', () => {
    setSsrData(makeSsrData());
    expect(getSsrData()?.cookies.get('nonexistent')).toBeUndefined();
  });
});

// ─── useParams SSR snapshot ──────────────────────────────────────

describe('useParams SSR data', () => {
  afterEach(() => {
    clearSsrData();
  });

  it('getSsrData provides params for server snapshot', () => {
    setSsrData(makeSsrData({ params: { id: '123', slug: ['a', 'b'] } }));
    expect(getSsrData()?.params).toEqual({ id: '123', slug: ['a', 'b'] });
  });

  it('returns undefined params outside SSR scope', () => {
    expect(getSsrData()?.params).toBeUndefined();
  });
});
