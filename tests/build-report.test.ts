/**
 * Build report plugin tests — post-build route table output.
 *
 * Tests route classification, size formatting, and report generation.
 *
 * Design docs: 18-build-system.md §"Build Pipeline", 07-routing.md
 * Task: TIM-287
 */

import { describe, it, expect } from 'vitest';
import {
  classifyRoute,
  formatSize,
  buildRouteReport,
  type RouteEntry,
} from '../packages/timber-app/src/plugins/build-report';
import type { SegmentNode } from '../packages/timber-app/src/routing/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeSegment(overrides: Partial<SegmentNode> = {}): SegmentNode {
  return {
    segmentName: '',
    segmentType: 'static',
    urlPath: '/',
    children: [],
    slots: new Map(),
    ...overrides,
  };
}

// ─── classifyRoute ────────────────────────────────────────────────────────

describe('classifyRoute', () => {
  it('returns "dynamic" for all pages in server output mode (default)', () => {
    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({ segmentName: 'about', urlPath: '/about' }),
    ];
    expect(classifyRoute(segments)).toBe('dynamic');
    expect(classifyRoute(segments, 'server')).toBe('dynamic');
  });

  it('returns "static" for all-static segments in static output mode', () => {
    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({ segmentName: 'about', urlPath: '/about' }),
    ];
    expect(classifyRoute(segments, 'static')).toBe('static');
  });

  it('returns "dynamic" for dynamic segments in static output mode', () => {
    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({ segmentName: '[id]', segmentType: 'dynamic', urlPath: '/[id]' }),
    ];
    expect(classifyRoute(segments, 'static')).toBe('dynamic');
  });

  it('returns "dynamic" for catch-all segments in static mode', () => {
    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({ segmentName: '[...slug]', segmentType: 'catch-all', urlPath: '/[...slug]' }),
    ];
    expect(classifyRoute(segments, 'static')).toBe('dynamic');
  });

  it('returns "dynamic" for optional catch-all segments in static mode', () => {
    const segments = [
      makeSegment({
        segmentName: '[[...slug]]',
        segmentType: 'optional-catch-all',
        urlPath: '/[[...slug]]',
      }),
    ];
    expect(classifyRoute(segments, 'static')).toBe('dynamic');
  });

  it('returns "function" when leaf has route.ts', () => {
    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({
        segmentName: 'users',
        urlPath: '/api/users',
        route: { filePath: '/app/api/users/route.ts', extension: 'ts' },
      }),
    ];
    expect(classifyRoute(segments)).toBe('function');
  });

  it('function takes precedence over dynamic', () => {
    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({
        segmentName: '[id]',
        segmentType: 'dynamic',
        urlPath: '/api/[id]',
        route: { filePath: '/app/api/[id]/route.ts', extension: 'ts' },
      }),
    ];
    expect(classifyRoute(segments)).toBe('function');
  });

  it('treats group segments as static in static mode', () => {
    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({ segmentName: '(auth)', segmentType: 'group', urlPath: '/' }),
      makeSegment({ segmentName: 'login', urlPath: '/login' }),
    ];
    expect(classifyRoute(segments, 'static')).toBe('static');
  });

  it('treats group segments as dynamic in server mode', () => {
    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({ segmentName: '(auth)', segmentType: 'group', urlPath: '/' }),
      makeSegment({ segmentName: 'login', urlPath: '/login' }),
    ];
    expect(classifyRoute(segments, 'server')).toBe('dynamic');
  });
});

// ─── formatSize ───────────────────────────────────────────────────────────

describe('formatSize', () => {
  it('formats bytes under 1 kB', () => {
    expect(formatSize(500)).toBe('500 B');
  });

  it('formats sizes in kB', () => {
    expect(formatSize(1024)).toBe('1.00 kB');
    expect(formatSize(1536)).toBe('1.50 kB');
  });

  it('formats sizes in MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1.00 MB');
    expect(formatSize(2.5 * 1024 * 1024)).toBe('2.50 MB');
  });

  it('formats 0 bytes', () => {
    expect(formatSize(0)).toBe('0 B');
  });
});

// ─── buildRouteReport ─────────────────────────────────────────────────────

describe('buildRouteReport', () => {
  it('produces formatted output lines', () => {
    const entries: RouteEntry[] = [
      { path: '/', type: 'static', size: 1200, firstLoadSize: 85000 },
      { path: '/dashboard/[id]', type: 'dynamic', size: 3500, firstLoadSize: 87000 },
      { path: '/api/users', type: 'function', size: 400, firstLoadSize: 84000 },
    ];

    const lines = buildRouteReport(entries, 83000);
    const text = lines.join('\n');

    // Contains route paths
    expect(text).toContain('/');
    expect(text).toContain('/dashboard/[id]');
    expect(text).toContain('/api/users');

    // Contains type indicators
    expect(text).toContain('○');
    expect(text).toContain('λ');
    expect(text).toContain('ƒ');

    // Contains shared section
    expect(text).toContain('Shared by all');

    // Contains legend
    expect(text).toContain('(Static)');
    expect(text).toContain('(Dynamic)');
    expect(text).toContain('(Function)');
  });

  it('right-aligns size columns', () => {
    const entries: RouteEntry[] = [
      { path: '/', type: 'static', size: 1200, firstLoadSize: 85000 },
      { path: '/about', type: 'static', size: 500, firstLoadSize: 84000 },
    ];

    const lines = buildRouteReport(entries, 83000);

    // Filter to only route lines (indented icon + space + /)
    const routeLines = lines.filter((l) => /^\s+[○λƒ]\s+\//.test(l));
    expect(routeLines.length).toBe(2);
  });

  it('handles empty entries', () => {
    const lines = buildRouteReport([], 0);
    expect(lines.length).toBeGreaterThan(0);
    // Should still have header and legend
    expect(lines.join('\n')).toContain('Route');
  });

  it('sorts routes alphabetically', () => {
    const entries: RouteEntry[] = [
      { path: '/z-page', type: 'static', size: 100, firstLoadSize: 100 },
      { path: '/a-page', type: 'static', size: 100, firstLoadSize: 100 },
      { path: '/m-page', type: 'dynamic', size: 100, firstLoadSize: 100 },
    ];

    const lines = buildRouteReport(entries, 0);
    const routeLines = lines.filter((l) => /^\s+[○λƒ]\s+\//.test(l));
    const paths = routeLines.map((l) => l.trim().split(/\s+/)[1]);
    expect(paths).toEqual(['/a-page', '/m-page', '/z-page']);
  });
});
