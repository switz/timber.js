/**
 * Tests for the useCookie client hook and SSR data integration.
 *
 * Since useCookie depends on React (useSyncExternalStore) and document.cookie,
 * we test the module-level helpers directly and verify the hook's contract
 * through the exported API surface.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { setSsrData, clearSsrData, getSsrData } from '../packages/timber-app/src/client/ssr-data';

// ─── SSR Data for cookies ────────────────────────────────────────

describe('SSR data for cookies', () => {
  afterEach(() => {
    clearSsrData();
  });

  it('provides cookie data via setSsrData', () => {
    const cookies = new Map([
      ['theme', 'dark'],
      ['locale', 'en'],
    ]);

    setSsrData({ pathname: '/', searchParams: {}, cookies, params: {} });
    const data = getSsrData();
    expect(data).toBeDefined();
    expect(data!.cookies.get('theme')).toBe('dark');
    expect(data!.cookies.get('locale')).toBe('en');
  });

  it('returns undefined outside SSR scope', () => {
    expect(getSsrData()).toBeUndefined();
  });
});

// ─── useCookie hook ─────────────────────────────────────────────

describe('useCookie', () => {
  it('exports useCookie function', async () => {
    const mod = await import('../packages/timber-app/src/client/use-cookie');
    expect(typeof mod.useCookie).toBe('function');
  });
});

// ─── @timber-js/app/cookies exports ────────────────────────────────

describe('@timber-js/app/cookies exports', () => {
  it('exports defineCookie', async () => {
    const mod = await import('../packages/timber-app/src/cookies/index');
    expect(typeof mod.defineCookie).toBe('function');
  });
});

// ─── @timber-js/app/client cookie exports ──────────────────────────

describe('@timber-js/app/client cookie exports', () => {
  it('exports useCookie from client index', async () => {
    const mod = await import('../packages/timber-app/src/client/index');
    expect(typeof mod.useCookie).toBe('function');
  });

  it('exports SSR data functions from client index', async () => {
    const mod = await import('../packages/timber-app/src/client/index');
    expect(typeof mod.setSsrData).toBe('function');
    expect(typeof mod.clearSsrData).toBe('function');
    expect(typeof mod.getSsrData).toBe('function');
  });
});
