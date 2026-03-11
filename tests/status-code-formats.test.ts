import { describe, expect, it } from 'vitest';
import type { RouteFile, SegmentNode } from '../packages/timber-app/src/routing/types';
import { resolveStatusFile } from '../packages/timber-app/src/server/status-code-resolver';
import { scanRoutes } from '../packages/timber-app/src/routing/scanner';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRouteFile(filePath: string, extension = 'tsx'): RouteFile {
  return { filePath, extension };
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

/** Create a temp directory with files for scanner tests. */
function createTempApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'timber-test-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

// ─── Scanner: MDX Status Files ───────────────────────────────────────────────

describe('scanner: mdx status files', () => {
  it('discovers 404.mdx when mdx is in pageExtensions', () => {
    const appDir = createTempApp({
      '404.mdx': '# Not Found',
      'page.tsx': 'export default function Home() {}',
    });
    const tree = scanRoutes(appDir, { pageExtensions: ['tsx', 'ts', 'mdx'] });
    expect(tree.root.statusFiles).toBeDefined();
    expect(tree.root.statusFiles!.get('404')).toBeDefined();
    expect(tree.root.statusFiles!.get('404')!.extension).toBe('mdx');
  });

  it('ignores 404.mdx when mdx is NOT in pageExtensions', () => {
    const appDir = createTempApp({
      '404.mdx': '# Not Found',
      'page.tsx': 'export default function Home() {}',
    });
    const tree = scanRoutes(appDir, { pageExtensions: ['tsx', 'ts'] });
    expect(tree.root.statusFiles).toBeUndefined();
  });

  it('discovers 4xx.mdx category catch-all', () => {
    const appDir = createTempApp({
      '4xx.mdx': '# Client Error',
      'page.tsx': 'export default function Home() {}',
    });
    const tree = scanRoutes(appDir, { pageExtensions: ['tsx', 'mdx'] });
    expect(tree.root.statusFiles!.get('4xx')).toBeDefined();
    expect(tree.root.statusFiles!.get('4xx')!.extension).toBe('mdx');
  });
});

// ─── Scanner: JSON Status Files ──────────────────────────────────────────────

describe('scanner: json status files', () => {
  it('discovers 401.json status file', () => {
    const appDir = createTempApp({
      '401.json': '{"error": true}',
      'page.tsx': 'export default function Home() {}',
    });
    const tree = scanRoutes(appDir);
    expect(tree.root.jsonStatusFiles).toBeDefined();
    expect(tree.root.jsonStatusFiles!.get('401')).toBeDefined();
    expect(tree.root.jsonStatusFiles!.get('401')!.extension).toBe('json');
  });

  it('discovers 4xx.json category catch-all', () => {
    const appDir = createTempApp({
      '4xx.json': '{"error": true}',
      'page.tsx': 'export default function Home() {}',
    });
    const tree = scanRoutes(appDir);
    expect(tree.root.jsonStatusFiles!.get('4xx')).toBeDefined();
  });

  it('json status files are discovered regardless of pageExtensions', () => {
    const appDir = createTempApp({
      '404.json': '{"error": "not found"}',
      'page.tsx': 'export default function Home() {}',
    });
    // Default pageExtensions (tsx, ts, jsx, js) — no json
    const tree = scanRoutes(appDir);
    expect(tree.root.jsonStatusFiles!.get('404')).toBeDefined();
  });

  it('json and tsx status files coexist in same segment', () => {
    const appDir = createTempApp({
      '401.tsx': 'export default function Unauthorized() {}',
      '401.json': '{"error": "unauthorized"}',
      'page.tsx': 'export default function Home() {}',
    });
    const tree = scanRoutes(appDir);
    expect(tree.root.statusFiles!.get('401')).toBeDefined();
    expect(tree.root.statusFiles!.get('401')!.extension).toBe('tsx');
    expect(tree.root.jsonStatusFiles!.get('401')).toBeDefined();
    expect(tree.root.jsonStatusFiles!.get('401')!.extension).toBe('json');
  });
});

// ─── Resolver: Format-Aware Fallback (Component Chain) ──────────────────────

describe('resolver: component format fallback', () => {
  it('mdx status file renders as RSC (resolved like tsx)', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('401', makeRouteFile('app/401.mdx', 'mdx'));

    const segments = [makeSegment({ statusFiles })];
    const result = resolveStatusFile(401, segments, 'component');
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/401.mdx');
    expect(result!.kind).toBe('exact');
  });

  it('component chain ignores json status files', () => {
    const jsonStatusFiles = new Map<string, RouteFile>();
    jsonStatusFiles.set('401', makeRouteFile('app/401.json', 'json'));

    const segments = [makeSegment({ jsonStatusFiles })];
    const result = resolveStatusFile(401, segments, 'component');
    expect(result).toBeNull();
  });

  it('shell default includes layouts (shell defaults to true)', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('403', makeRouteFile('app/403.tsx', 'tsx'));

    const segments = [makeSegment({ statusFiles })];
    const result = resolveStatusFile(403, segments, 'component');
    expect(result).not.toBeNull();
    // shell defaults to true — caller wraps in layouts
    expect(result!.file.filePath).toBe('app/403.tsx');
  });
});

// ─── Resolver: Format-Aware Fallback (JSON Chain) ───────────────────────────

describe('resolver: json format fallback', () => {
  it('json status file returns JSON response', () => {
    const jsonStatusFiles = new Map<string, RouteFile>();
    jsonStatusFiles.set('401', makeRouteFile('app/401.json', 'json'));

    const segments = [makeSegment({ jsonStatusFiles })];
    const result = resolveStatusFile(401, segments, 'json');
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/401.json');
    expect(result!.kind).toBe('exact');
  });

  it('json fallback chain: 401.json -> 4xx.json', () => {
    const jsonStatusFiles = new Map<string, RouteFile>();
    jsonStatusFiles.set('4xx', makeRouteFile('app/4xx.json', 'json'));

    const segments = [makeSegment({ jsonStatusFiles })];
    const result = resolveStatusFile(401, segments, 'json');
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/4xx.json');
    expect(result!.kind).toBe('category');
  });

  it('json chain walks up segments (leaf -> root)', () => {
    const rootJsonFiles = new Map<string, RouteFile>();
    rootJsonFiles.set('4xx', makeRouteFile('app/4xx.json', 'json'));

    const segments = [
      makeSegment({ jsonStatusFiles: rootJsonFiles }),
      makeSegment({ segmentName: 'api', urlPath: '/api' }),
    ];

    const result = resolveStatusFile(403, segments, 'json');
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/4xx.json');
    expect(result!.segmentIndex).toBe(0);
  });

  it('json chain ignores component status files', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('401', makeRouteFile('app/401.tsx', 'tsx'));

    const segments = [makeSegment({ statusFiles })];
    const result = resolveStatusFile(401, segments, 'json');
    expect(result).toBeNull();
  });

  it('json chain does not fall back to error.tsx', () => {
    const segments = [makeSegment({ error: makeRouteFile('app/error.tsx') })];
    const result = resolveStatusFile(401, segments, 'json');
    expect(result).toBeNull();
  });
});

// ─── Resolver: deny() format selection ──────────────────────────────────────

describe('deny format selection', () => {
  it('deny uses json for route handlers (route.ts segments)', () => {
    const jsonStatusFiles = new Map<string, RouteFile>();
    jsonStatusFiles.set('401', makeRouteFile('app/api/401.json', 'json'));

    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('401', makeRouteFile('app/api/401.tsx', 'tsx'));

    const segments = [
      makeSegment({
        segmentName: 'api',
        urlPath: '/api',
        statusFiles,
        jsonStatusFiles,
        route: makeRouteFile('app/api/route.ts', 'ts'),
      }),
    ];

    // When the leaf segment has route.ts, prefer json format
    const result = resolveStatusFile(401, segments, 'json');
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/api/401.json');
  });

  it('deny uses component for page routes', () => {
    const jsonStatusFiles = new Map<string, RouteFile>();
    jsonStatusFiles.set('401', makeRouteFile('app/401.json', 'json'));

    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('401', makeRouteFile('app/401.tsx', 'tsx'));

    const segments = [
      makeSegment({
        statusFiles,
        jsonStatusFiles,
        page: makeRouteFile('app/page.tsx', 'tsx'),
      }),
    ];

    // When the leaf segment has page.tsx, prefer component format
    const result = resolveStatusFile(401, segments, 'component');
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/401.tsx');
  });
});

// ─── Resolver: Page route JSON fallback ─────────────────────────────────────

describe('page route json fallback', () => {
  it('page route with only json status file resolves via json chain', () => {
    // No component 401.tsx, only 401.json — page route should find it via json fallback
    const jsonStatusFiles = new Map<string, RouteFile>();
    jsonStatusFiles.set('401', makeRouteFile('app/deny-401/401.json', 'json'));

    const segments = [
      makeSegment(),
      makeSegment({
        segmentName: 'deny-401',
        urlPath: '/deny-401',
        jsonStatusFiles,
        page: makeRouteFile('app/deny-401/page.tsx', 'tsx'),
      }),
    ];

    // Component chain finds nothing
    const componentResult = resolveStatusFile(401, segments, 'component');
    expect(componentResult).toBeNull();

    // JSON chain finds 401.json — this is what renderDenyPage falls back to
    const jsonResult = resolveStatusFile(401, segments, 'json');
    expect(jsonResult).not.toBeNull();
    expect(jsonResult!.file.filePath).toBe('app/deny-401/401.json');
  });

  it('page route prefers component over json when both exist', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('401', makeRouteFile('app/401.tsx', 'tsx'));

    const jsonStatusFiles = new Map<string, RouteFile>();
    jsonStatusFiles.set('401', makeRouteFile('app/401.json', 'json'));

    const segments = [makeSegment({ statusFiles, jsonStatusFiles })];

    // Component chain finds 401.tsx — json is never tried
    const result = resolveStatusFile(401, segments, 'component');
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/401.tsx');
  });

  it('page route falls through component chain completely before trying json', () => {
    // Root has error.tsx (component chain), leaf has only 401.json
    // Component chain should find error.tsx (not fall to json)
    const jsonStatusFiles = new Map<string, RouteFile>();
    jsonStatusFiles.set('401', makeRouteFile('app/leaf/401.json', 'json'));

    const segments = [
      makeSegment({ error: makeRouteFile('app/error.tsx') }),
      makeSegment({
        segmentName: 'leaf',
        urlPath: '/leaf',
        jsonStatusFiles,
      }),
    ];

    // Component chain finds error.tsx in root
    const componentResult = resolveStatusFile(401, segments, 'component');
    expect(componentResult).not.toBeNull();
    expect(componentResult!.file.filePath).toBe('app/error.tsx');
    expect(componentResult!.kind).toBe('error');
  });
});

// ─── Resolver: Backwards Compatibility ──────────────────────────────────────

describe('backwards compatibility', () => {
  it('default format is component (no format arg)', () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('403', makeRouteFile('app/403.tsx'));

    const segments = [makeSegment({ statusFiles })];

    // No format argument — should default to component behavior
    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/403.tsx');
  });

  it('existing fallback chain unchanged for component format', () => {
    const rootStatusFiles = new Map<string, RouteFile>();
    rootStatusFiles.set('4xx', makeRouteFile('app/4xx.tsx'));

    const segments = [
      makeSegment({ statusFiles: rootStatusFiles }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        error: makeRouteFile('app/dashboard/error.tsx'),
      }),
    ];

    // Same behavior as before: root's 4xx.tsx wins over leaf's error.tsx
    const result = resolveStatusFile(403, segments);
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/4xx.tsx');
    expect(result!.kind).toBe('category');
  });
});

// ─── Shell Opt-Out ──────────────────────────────────────────────────────────

describe('shell opt-out', () => {
  // Note: shell opt-out is a runtime concern — the resolver returns the file,
  // and the deny renderer reads `export const shell` from the loaded module.
  // These tests verify the resolver still resolves the file correctly;
  // the shell behavior is tested in integration/e2e tests.

  it('shell opt-out renders without layouts (design validation)', () => {
    // This test validates the contract: when a status file exports shell=false,
    // the deny renderer should NOT wrap it in layouts.
    // The resolver itself doesn't know about shell — it just finds the file.
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('401', makeRouteFile('app/401.tsx'));

    const segments = [
      makeSegment({
        layout: makeRouteFile('app/layout.tsx'),
        statusFiles,
      }),
    ];

    const result = resolveStatusFile(401, segments, 'component');
    expect(result).not.toBeNull();
    expect(result!.file.filePath).toBe('app/401.tsx');
    // The segmentIndex tells the deny renderer which layouts to wrap.
    // With shell=false, the renderer skips ALL layouts regardless of segmentIndex.
    expect(result!.segmentIndex).toBe(0);
  });
});
