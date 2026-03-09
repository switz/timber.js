import { describe, expect, it } from 'vitest';
import type { RouteFile, SegmentNode } from '../packages/timber-app/src/routing/types';
import {
  resolveSlotDenied,
  resolveStatusFile,
} from '../packages/timber-app/src/server/status-code-resolver';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Specific Status Files ────────────────────────────────────────────────────

describe('specific status file', () => {
  it('resolves 429.tsx for deny(429)', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('429', makeRouteFile('app/dashboard/429.tsx'));

    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({ segmentName: 'dashboard', urlPath: '/dashboard', statusFiles }),
    ];

    const result = resolveStatusFile(429, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/dashboard/429.tsx');
    expect(result!.segmentIndex).toBe(1);
  });

  it('resolves 503.tsx for RenderError with status 503', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('503', makeRouteFile('app/503.tsx'));

    const segments = [makeSegment({ segmentName: '', urlPath: '/', statusFiles })];

    const result = resolveStatusFile(503, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/503.tsx');
  });
});

// ─── 4xx Catch-All ────────────────────────────────────────────────────────────

describe('4xx catch-all', () => {
  it('resolves 4xx.tsx when no specific status file matches', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('4xx', makeRouteFile('app/dashboard/4xx.tsx'));

    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({ segmentName: 'dashboard', urlPath: '/dashboard', statusFiles }),
    ];

    const result = resolveStatusFile(401, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/dashboard/4xx.tsx');
    expect(result!.kind).toBe('category');
  });

  it('specific 403.tsx takes priority over 4xx.tsx in same segment', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('403', makeRouteFile('app/403.tsx'));
    statusFiles.set('4xx', makeRouteFile('app/4xx.tsx'));

    const segments = [makeSegment({ segmentName: '', urlPath: '/', statusFiles })];

    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/403.tsx');
    expect(result!.kind).toBe('exact');
  });
});

// ─── 5xx Catch-All ────────────────────────────────────────────────────────────

describe('5xx catch-all', () => {
  it('resolves 5xx.tsx for unhandled server errors', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('5xx', makeRouteFile('app/5xx.tsx'));

    const segments = [makeSegment({ segmentName: '', urlPath: '/', statusFiles })];

    const result = resolveStatusFile(500, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/5xx.tsx');
    expect(result!.kind).toBe('category');
  });

  it('specific 503.tsx takes priority over 5xx.tsx in same segment', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('503', makeRouteFile('app/503.tsx'));
    statusFiles.set('5xx', makeRouteFile('app/5xx.tsx'));

    const segments = [makeSegment({ segmentName: '', urlPath: '/', statusFiles })];

    const result = resolveStatusFile(503, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/503.tsx');
    expect(result!.kind).toBe('exact');
  });
});

// ─── Error Boundary ───────────────────────────────────────────────────────────

describe('error boundary', () => {
  it('falls back to error.tsx when no status-code file matches', () => {
    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        error: makeRouteFile('app/error.tsx'),
      }),
    ];

    const result = resolveStatusFile(500, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/error.tsx');
    expect(result!.kind).toBe('error');
  });

  it('status-code file takes priority over error.tsx in same segment', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('5xx', makeRouteFile('app/5xx.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        statusFiles,
        error: makeRouteFile('app/error.tsx'),
      }),
    ];

    const result = resolveStatusFile(500, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/5xx.tsx');
    expect(result!.kind).toBe('category');
  });
});

// ─── denied.tsx (Slot Only) ─────────────────────────────────────────────────

describe('denied.tsx slot only', () => {
  it('resolves denied.tsx for a slot', () => {
    const slotNode = makeSegment({
      segmentName: '@admin',
      segmentType: 'slot',
      urlPath: '/',
      denied: makeRouteFile('app/@admin/denied.tsx'),
    });

    const result = resolveSlotDenied(slotNode);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/@admin/denied.tsx');
    expect(result!.slotName).toBe('admin');
  });

  it('falls back to default.tsx when no denied.tsx', () => {
    const slotNode = makeSegment({
      segmentName: '@sidebar',
      segmentType: 'slot',
      urlPath: '/',
      default: makeRouteFile('app/@sidebar/default.tsx'),
    });

    const result = resolveSlotDenied(slotNode);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/@sidebar/default.tsx');
    expect(result!.kind).toBe('default');
  });

  it('returns null when no denied.tsx and no default.tsx', () => {
    const slotNode = makeSegment({
      segmentName: '@empty',
      segmentType: 'slot',
      urlPath: '/',
    });

    const result = resolveSlotDenied(slotNode);
    expect(result).toBeNull();
  });
});

// ─── Fallback Chain ─────────────────────────────────────────────────────────

describe('fallback chain', () => {
  it('walks up segment tree from leaf to root', () => {
    const rootStatusFiles = new Map<string, RouteFile>();
    rootStatusFiles.set('403', makeRouteFile('app/403.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        statusFiles: rootStatusFiles,
      }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        // No status files in leaf — should walk up to root
      }),
    ];

    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/403.tsx');
    expect(result!.segmentIndex).toBe(0); // Found in root
  });

  it('nearer segment 4xx.tsx wins over farther 403.tsx', () => {
    const rootStatusFiles = new Map<string, RouteFile>();
    rootStatusFiles.set('403', makeRouteFile('app/403.tsx'));

    const dashStatusFiles = new Map<string, RouteFile>();
    dashStatusFiles.set('4xx', makeRouteFile('app/dashboard/4xx.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        statusFiles: rootStatusFiles,
      }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        statusFiles: dashStatusFiles,
      }),
    ];

    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    // Leaf segment's 4xx.tsx is nearer, so it wins
    expect(result!.file.filePath).toBe('app/dashboard/4xx.tsx');
    expect(result!.segmentIndex).toBe(1);
  });

  it('error.tsx in leaf wins over status file in parent', () => {
    const rootStatusFiles = new Map<string, RouteFile>();
    rootStatusFiles.set('5xx', makeRouteFile('app/5xx.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        statusFiles: rootStatusFiles,
      }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        error: makeRouteFile('app/dashboard/error.tsx'),
      }),
    ];

    // For 5xx: at leaf, no status files but error.tsx exists → use it
    // error.tsx catches "anything not matched by status files" at that level
    // But per design: at each segment level check exact → category → then error.tsx
    // So leaf's error.tsx should NOT catch a 5xx if leaf has no 5xx status file
    // Actually re-reading: "For 5xx: At each segment (leaf → root): {status}.tsx → 5xx.tsx → error.tsx"
    // So error.tsx IS checked per-segment for 5xx. Leaf error.tsx wins.
    const result = resolveStatusFile(500, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/dashboard/error.tsx');
    expect(result!.segmentIndex).toBe(1);
  });

  it('returns null when no status file found anywhere (framework default)', () => {
    const segments = [
      makeSegment({ segmentName: '', urlPath: '/' }),
      makeSegment({ segmentName: 'dashboard', urlPath: '/dashboard' }),
    ];

    const result = resolveStatusFile(404, segments);
    expect(result).toBeNull();
  });

  it('walks full chain: leaf exact → leaf category → leaf error → parent exact → parent category → parent error', () => {
    // Only parent has error.tsx, nothing else
    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        error: makeRouteFile('app/error.tsx'),
      }),
      makeSegment({
        segmentName: 'settings',
        urlPath: '/settings',
      }),
      makeSegment({
        segmentName: 'profile',
        urlPath: '/settings/profile',
      }),
    ];

    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/error.tsx');
    expect(result!.segmentIndex).toBe(0);
  });
});

// ─── 4xx Props ──────────────────────────────────────────────────────────────

describe('4xx props', () => {
  it('resolution includes correct status for 4xx files', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('403', makeRouteFile('app/403.tsx'));

    const segments = [makeSegment({ segmentName: '', urlPath: '/', statusFiles })];

    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    expect(result!.kind).toBe('exact');
  });

  it('resolution includes correct status for category match', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('4xx', makeRouteFile('app/4xx.tsx'));

    const segments = [makeSegment({ segmentName: '', urlPath: '/', statusFiles })];

    const result = resolveStatusFile(429, segments);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
    expect(result!.kind).toBe('category');
  });
});

// ─── denied.tsx Props ──────────────────────────────────────────────────────

describe('denied props', () => {
  it('slot name strips @ prefix', () => {
    const slotNode = makeSegment({
      segmentName: '@admin',
      segmentType: 'slot',
      urlPath: '/',
      denied: makeRouteFile('app/@admin/denied.tsx'),
    });

    const result = resolveSlotDenied(slotNode);
    expect(result).not.toBeNull();
    expect(result!.slotName).toBe('admin');
  });

  it('slot name for nested slot', () => {
    const slotNode = makeSegment({
      segmentName: '@user-profile',
      segmentType: 'slot',
      urlPath: '/',
      denied: makeRouteFile('app/@user-profile/denied.tsx'),
    });

    const result = resolveSlotDenied(slotNode);
    expect(result).not.toBeNull();
    expect(result!.slotName).toBe('user-profile');
  });
});

// ─── 5xx Fallback Chain ────────────────────────────────────────────────────

describe('5xx fallback chain', () => {
  it('5xx chain: exact → 5xx → error.tsx → walk up', () => {
    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        error: makeRouteFile('app/error.tsx'),
      }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        // No status files, no error.tsx → walks up to root error.tsx
      }),
    ];

    const result = resolveStatusFile(500, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/error.tsx');
    expect(result!.kind).toBe('error');
  });

  it('5xx.tsx in leaf takes priority over error.tsx in leaf', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('5xx', makeRouteFile('app/5xx.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        statusFiles,
        error: makeRouteFile('app/error.tsx'),
      }),
    ];

    const result = resolveStatusFile(500, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/5xx.tsx');
    expect(result!.kind).toBe('category');
  });
});

// ─── 4xx Fallback Chain ────────────────────────────────────────────────────

describe('4xx fallback chain', () => {
  it('4xx chain does NOT check error.tsx at same segment level (4xx only checks exact → category per segment)', () => {
    // Per design: "For 4xx: At each segment (leaf → root): {status}.tsx → 4xx.tsx.
    // Then error.tsx (leaf → root)."
    // This means error.tsx is checked in a SEPARATE pass after all segments are exhausted for status files.
    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        error: makeRouteFile('app/error.tsx'),
      }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        error: makeRouteFile('app/dashboard/error.tsx'),
      }),
    ];

    // With no status files at all, should fall back to leaf error.tsx
    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/dashboard/error.tsx');
    expect(result!.kind).toBe('error');
  });

  it('4xx: status files across ALL segments checked before error.tsx in any segment', () => {
    // Root has 4xx.tsx, leaf has only error.tsx
    // Per design: status files (all segments) → legacy compat (all segments) → error.tsx (all segments)
    // So root's 4xx.tsx should win over leaf's error.tsx
    const rootStatusFiles = new Map<string, RouteFile>();
    rootStatusFiles.set('4xx', makeRouteFile('app/4xx.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        statusFiles: rootStatusFiles,
      }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        error: makeRouteFile('app/dashboard/error.tsx'),
      }),
    ];

    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/4xx.tsx');
    expect(result!.kind).toBe('category');
  });
});

// ─── Legacy Compat Files ──────────────────────────────────────────────────

describe('legacy compat files', () => {
  it('not-found.tsx resolves for deny(404)', () => {
    const legacyStatusFiles = new Map<string, RouteFile>();
    legacyStatusFiles.set('not-found', makeRouteFile('app/not-found.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        legacyStatusFiles,
      }),
    ];

    const result = resolveStatusFile(404, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/not-found.tsx');
    expect(result!.kind).toBe('legacy');
  });

  it('forbidden.tsx resolves for deny(403)', () => {
    const legacyStatusFiles = new Map<string, RouteFile>();
    legacyStatusFiles.set('forbidden', makeRouteFile('app/forbidden.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        legacyStatusFiles,
      }),
    ];

    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/forbidden.tsx');
    expect(result!.kind).toBe('legacy');
  });

  it('unauthorized.tsx resolves for deny(401)', () => {
    const legacyStatusFiles = new Map<string, RouteFile>();
    legacyStatusFiles.set('unauthorized', makeRouteFile('app/unauthorized.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        legacyStatusFiles,
      }),
    ];

    const result = resolveStatusFile(401, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/unauthorized.tsx');
    expect(result!.kind).toBe('legacy');
  });

  it('status-code file takes priority over legacy compat in same segment', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('404', makeRouteFile('app/404.tsx'));

    const legacyStatusFiles = new Map<string, RouteFile>();
    legacyStatusFiles.set('not-found', makeRouteFile('app/not-found.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        statusFiles,
        legacyStatusFiles,
      }),
    ];

    const result = resolveStatusFile(404, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/404.tsx');
    expect(result!.kind).toBe('exact');
  });

  it('legacy compat checked after status files across all segments, before error.tsx', () => {
    // Leaf has no status files, root has not-found.tsx, leaf has error.tsx
    // Chain: status files (all segments) → legacy (all segments) → error.tsx (all segments)
    const legacyStatusFiles = new Map<string, RouteFile>();
    legacyStatusFiles.set('not-found', makeRouteFile('app/not-found.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        legacyStatusFiles,
      }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        error: makeRouteFile('app/dashboard/error.tsx'),
      }),
    ];

    const result = resolveStatusFile(404, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/not-found.tsx');
    expect(result!.kind).toBe('legacy');
  });

  it('legacy not-found.tsx does NOT match for non-404 status', () => {
    const legacyStatusFiles = new Map<string, RouteFile>();
    legacyStatusFiles.set('not-found', makeRouteFile('app/not-found.tsx'));

    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        legacyStatusFiles,
      }),
    ];

    const result = resolveStatusFile(403, segments);
    expect(result).toBeNull();
  });
});
