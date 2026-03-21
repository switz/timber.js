// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isStaleClientReference,
  triggerStaleReload,
  clearStaleReloadFlag,
} from '../packages/timber-app/src/client/stale-reload';

describe('isStaleClientReference', () => {
  it('detects "Could not find the module" errors', () => {
    const error = new Error(
      'Could not find the module "/_build/assets/Counter-abc123.js" in the React SSR manifest.'
    );
    expect(isStaleClientReference(error)).toBe(true);
  });

  it('detects exact React Flight error message', () => {
    const error = new Error('Could not find the module "/assets/page-xyz789.js"');
    expect(isStaleClientReference(error)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isStaleClientReference(new Error('Network error'))).toBe(false);
    expect(isStaleClientReference(new Error('Connection closed.'))).toBe(false);
    expect(isStaleClientReference(new Error('Unexpected token <'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isStaleClientReference('string error')).toBe(false);
    expect(isStaleClientReference(null)).toBe(false);
    expect(isStaleClientReference(undefined)).toBe(false);
    expect(isStaleClientReference(42)).toBe(false);
  });

  it('returns false for errors with similar but different messages', () => {
    expect(isStaleClientReference(new Error('module not found'))).toBe(false);
    expect(isStaleClientReference(new Error('Module not found'))).toBe(false);
  });
});

describe('triggerStaleReload', () => {
  let originalReload: () => void;

  beforeEach(() => {
    // Mock window.location.reload
    originalReload = window.location.reload;
    window.location.reload = vi.fn();
    // Clear sessionStorage
    sessionStorage.clear();
  });

  afterEach(() => {
    window.location.reload = originalReload;
    sessionStorage.clear();
  });

  it('calls window.location.reload()', () => {
    triggerStaleReload();
    expect(window.location.reload).toHaveBeenCalledOnce();
  });

  it('sets sessionStorage flag before reloading', () => {
    triggerStaleReload();
    expect(sessionStorage.getItem('__timber_stale_reload')).toBe('1');
  });

  it('returns true when reload is triggered', () => {
    expect(triggerStaleReload()).toBe(true);
  });

  it('does NOT reload if flag is already set (loop guard)', () => {
    sessionStorage.setItem('__timber_stale_reload', '1');
    const result = triggerStaleReload();
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('logs a warning before reloading', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    triggerStaleReload();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Stale client reference detected')
    );
    warnSpy.mockRestore();
  });

  it('logs a different warning when suppressing reload loop', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sessionStorage.setItem('__timber_stale_reload', '1');
    triggerStaleReload();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not reloading to prevent infinite loop')
    );
    warnSpy.mockRestore();
  });
});

describe('clearStaleReloadFlag', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('removes the reload flag from sessionStorage', () => {
    sessionStorage.setItem('__timber_stale_reload', '1');
    clearStaleReloadFlag();
    expect(sessionStorage.getItem('__timber_stale_reload')).toBeNull();
  });

  it('is a no-op if flag is not set', () => {
    expect(() => clearStaleReloadFlag()).not.toThrow();
  });
});

// ─── Router integration ─────────────────────────────────────────

import { createRouter } from '../packages/timber-app/src/client/router';

describe('Router stale client reference handling', () => {
  // The stale reference detection is wired in browser-entry.ts via the
  // decodeRsc dep. These tests verify the router's error propagation
  // behavior — the actual interception happens in browser-entry.ts.

  it('propagates decodeRsc errors to navigate() caller', async () => {
    const staleError = new Error('Could not find the module "/assets/old-chunk.js"');
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('rsc-data', {
        headers: { 'content-type': 'text/x-component' },
      })
    );

    const router = createRouter({
      fetch: mockFetch,
      pushState: vi.fn(),
      replaceState: vi.fn(),
      scrollTo: vi.fn(),
      getCurrentUrl: () => '/',
      getScrollY: () => 0,
      decodeRsc: () => {
        throw staleError;
      },
    });

    await expect(router.navigate('/projects')).rejects.toThrow(
      'Could not find the module'
    );
  });

  it('propagates decodeRsc errors to refresh() caller', async () => {
    const staleError = new Error('Could not find the module "/assets/old-chunk.js"');
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('rsc-data', {
        headers: { 'content-type': 'text/x-component' },
      })
    );

    const router = createRouter({
      fetch: mockFetch,
      pushState: vi.fn(),
      replaceState: vi.fn(),
      scrollTo: vi.fn(),
      getCurrentUrl: () => '/',
      getScrollY: () => 0,
      decodeRsc: () => {
        throw staleError;
      },
    });

    await expect(router.refresh()).rejects.toThrow(
      'Could not find the module'
    );
  });
});
