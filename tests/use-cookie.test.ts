/**
 * Tests for the useCookie client hook.
 *
 * Since useCookie depends on React (useSyncExternalStore) and document.cookie,
 * we test the module-level helpers directly and verify the hook's contract
 * through the exported API surface.
 */

import { describe, it, expect } from 'vitest';
import { setServerCookieSnapshot } from '../packages/timber-app/src/client/use-cookie';

// ─── setServerCookieSnapshot ────────────────────────────────────

describe('setServerCookieSnapshot', () => {
  it('accepts a Map of cookie values', () => {
    const cookies = new Map([
      ['theme', 'dark'],
      ['locale', 'en'],
    ]);

    // Should not throw
    expect(() => setServerCookieSnapshot(cookies)).not.toThrow();
  });
});

// ─── useCookie hook ─────────────────────────────────────────────

describe('useCookie', () => {
  // We test the hook contract via the exported types and API surface.
  // Full integration tests with React rendering belong in e2e tests.

  it('exports useCookie function', async () => {
    const mod = await import('../packages/timber-app/src/client/use-cookie');
    expect(typeof mod.useCookie).toBe('function');
  });

  it('exports setServerCookieSnapshot function', async () => {
    const mod = await import('../packages/timber-app/src/client/use-cookie');
    expect(typeof mod.setServerCookieSnapshot).toBe('function');
  });
});

// ─── @timber/app/cookies exports ────────────────────────────────

describe('@timber/app/cookies exports', () => {
  it('exports defineCookie', async () => {
    const mod = await import('../packages/timber-app/src/cookies/index');
    expect(typeof mod.defineCookie).toBe('function');
  });
});

// ─── @timber/app/client cookie exports ──────────────────────────

describe('@timber/app/client cookie exports', () => {
  it('exports useCookie from client index', async () => {
    const mod = await import('../packages/timber-app/src/client/index');
    expect(typeof mod.useCookie).toBe('function');
    expect(typeof mod.setServerCookieSnapshot).toBe('function');
  });
});
