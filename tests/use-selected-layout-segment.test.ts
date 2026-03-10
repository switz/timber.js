import { describe, it, expect } from 'vitest';

// ─── Pure logic tests ────────────────────────────────────────────

import {
  pathnameToSegments,
  getSelectedSegment,
  getSelectedSegments,
} from '../packages/timber-app/src/client/use-selected-layout-segment';

describe('pathnameToSegments', () => {
  it('splits root pathname', () => {
    expect(pathnameToSegments('/')).toEqual(['', '']);
  });

  it('splits single-level pathname', () => {
    expect(pathnameToSegments('/dashboard')).toEqual(['', 'dashboard']);
  });

  it('splits multi-level pathname', () => {
    expect(pathnameToSegments('/dashboard/settings/profile')).toEqual([
      '',
      'dashboard',
      'settings',
      'profile',
    ]);
  });
});

describe('getSelectedSegment', () => {
  it('returns active segment from root layout', () => {
    // Root layout has segments [''] (depth 1), URL is /dashboard/settings
    const result = getSelectedSegment([''], '/dashboard/settings');
    expect(result).toBe('dashboard');
  });

  it('returns active segment from nested layout', () => {
    // Dashboard layout has segments ['', 'dashboard'] (depth 2)
    const result = getSelectedSegment(['', 'dashboard'], '/dashboard/settings/profile');
    expect(result).toBe('settings');
  });

  it('returns active segment from deeply nested layout', () => {
    const result = getSelectedSegment(
      ['', 'dashboard', 'settings'],
      '/dashboard/settings/profile'
    );
    expect(result).toBe('profile');
  });

  it('returns null when layout is at the leaf', () => {
    const result = getSelectedSegment(
      ['', 'dashboard', 'settings', 'profile'],
      '/dashboard/settings/profile'
    );
    expect(result).toBeNull();
  });

  it('returns null for root URL from root layout', () => {
    // Root layout at "/", URL is "/"
    const result = getSelectedSegment([''], '/');
    // "/" splits to ["", ""], urlSegments[1] is "" which is falsy → null
    expect(result).toBeNull();
  });

  it('falls back to first segment when no context', () => {
    const result = getSelectedSegment(null, '/dashboard/settings');
    expect(result).toBe('dashboard');
  });

  it('falls back to null for root when no context', () => {
    const result = getSelectedSegment(null, '/');
    expect(result).toBeNull();
  });
});

describe('getSelectedSegments', () => {
  it('returns all segments below root layout', () => {
    const result = getSelectedSegments([''], '/dashboard/settings/profile');
    expect(result).toEqual(['dashboard', 'settings', 'profile']);
  });

  it('returns segments below nested layout', () => {
    const result = getSelectedSegments(['', 'dashboard'], '/dashboard/settings/profile');
    expect(result).toEqual(['settings', 'profile']);
  });

  it('returns single segment below layout', () => {
    const result = getSelectedSegments(
      ['', 'dashboard', 'settings'],
      '/dashboard/settings/profile'
    );
    expect(result).toEqual(['profile']);
  });

  it('returns empty array when layout is at the leaf', () => {
    const result = getSelectedSegments(
      ['', 'dashboard', 'settings', 'profile'],
      '/dashboard/settings/profile'
    );
    expect(result).toEqual([]);
  });

  it('returns empty array for root URL from root layout', () => {
    const result = getSelectedSegments([''], '/');
    expect(result).toEqual([]);
  });

  it('falls back to all segments when no context', () => {
    const result = getSelectedSegments(null, '/dashboard/settings');
    expect(result).toEqual(['dashboard', 'settings']);
  });

  it('falls back to empty for root when no context', () => {
    const result = getSelectedSegments(null, '/');
    expect(result).toEqual([]);
  });
});

// ─── Shim exports ────────────────────────────────────────────────

describe('navigation shim exports', () => {
  it('exports useSelectedLayoutSegment', async () => {
    const shim = await import('../packages/timber-app/src/shims/navigation');
    expect(typeof shim.useSelectedLayoutSegment).toBe('function');
  });

  it('exports useSelectedLayoutSegments', async () => {
    const shim = await import('../packages/timber-app/src/shims/navigation');
    expect(typeof shim.useSelectedLayoutSegments).toBe('function');
  });
});

// ─── Client index exports ────────────────────────────────────────

describe('client index exports', () => {
  it('exports useSelectedLayoutSegment from client index', async () => {
    const client = await import('../packages/timber-app/src/client/index');
    expect(typeof client.useSelectedLayoutSegment).toBe('function');
  });

  it('exports useSelectedLayoutSegments from client index', async () => {
    const client = await import('../packages/timber-app/src/client/index');
    expect(typeof client.useSelectedLayoutSegments).toBe('function');
  });

  it('exports SegmentProvider from client index', async () => {
    const client = await import('../packages/timber-app/src/client/index');
    expect(typeof client.SegmentProvider).toBe('function');
  });
});
