/**
 * Tests for client hooks' SSR behavior.
 *
 * Verifies that hooks return correct request data during server-side rendering
 * via the SSR data context (setSsrData/getSsrData), instead of client-only defaults.
 *
 * These are unit tests for the hook logic — full integration with React
 * renderToReadableStream is tested in e2e tests.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { setSsrData, clearSsrData, getSsrData } from '../packages/timber-app/src/client/ssr-data';

// ─── SSR Data ────────────────────────────────────────────────────

describe('setSsrData / getSsrData / clearSsrData', () => {
  afterEach(() => {
    clearSsrData();
  });

  it('provides pathname after setSsrData', () => {
    setSsrData({ pathname: '/dashboard/settings', searchParams: {}, cookies: new Map() });
    expect(getSsrData()?.pathname).toBe('/dashboard/settings');
  });

  it('provides search params after setSsrData', () => {
    setSsrData({ pathname: '/', searchParams: { page: '2', sort: 'name' }, cookies: new Map() });
    expect(getSsrData()?.searchParams).toEqual({ page: '2', sort: 'name' });
  });

  it('provides cookies after setSsrData', () => {
    const cookies = new Map([['session', 'abc123']]);
    setSsrData({ pathname: '/', searchParams: {}, cookies });
    expect(getSsrData()?.cookies.get('session')).toBe('abc123');
  });

  it('returns undefined before setSsrData is called', () => {
    expect(getSsrData()).toBeUndefined();
  });

  it('returns undefined after clearSsrData', () => {
    setSsrData({ pathname: '/test', searchParams: {}, cookies: new Map() });
    clearSsrData();
    expect(getSsrData()).toBeUndefined();
  });

  it('overwrites data on subsequent setSsrData calls', () => {
    setSsrData({ pathname: '/a', searchParams: {}, cookies: new Map() });
    expect(getSsrData()?.pathname).toBe('/a');

    setSsrData({ pathname: '/b', searchParams: {}, cookies: new Map() });
    expect(getSsrData()?.pathname).toBe('/b');
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
    setSsrData({ pathname: '/products/123', searchParams: {}, cookies: new Map() });
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
    setSsrData({ pathname: '/', searchParams: { q: 'test', page: '1' }, cookies: new Map() });
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
    setSsrData({ pathname: '/', searchParams: {}, cookies });
    expect(getSsrData()?.cookies.get('theme')).toBe('dark');
    expect(getSsrData()?.cookies.get('locale')).toBe('en');
  });

  it('returns undefined for missing cookies', () => {
    setSsrData({ pathname: '/', searchParams: {}, cookies: new Map() });
    expect(getSsrData()?.cookies.get('nonexistent')).toBeUndefined();
  });
});
