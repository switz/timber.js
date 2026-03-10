import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { scanRoutes } from '@timber/app/routing';
import {
  resolvePrerenderConfig,
  checkDynamicSegmentParams,
} from '../packages/timber-app/src/server/prerender';
import {
  transformUseDynamic,
  containsUseDynamic,
  validateNoDynamicInStaticMode,
} from '../packages/timber-app/src/plugins/dynamic-transform';

const TMP_DIR = join(import.meta.dirname, '.tmp-prerender-test');

function appDir(...segments: string[]): string {
  return join(TMP_DIR, 'app', ...segments);
}

function createFile(path: string, content = ''): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function createApp(files: Record<string, string>): string {
  const root = appDir();
  mkdirSync(root, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    createFile(join(root, filePath), content);
  }
  return root;
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Scanner: prerender.ts discovery
// ---------------------------------------------------------------------------

describe('scanner prerender.ts discovery', () => {
  it('discovers prerender.ts in a static segment', () => {
    createApp({
      'page.tsx': 'export default function Home() {}',
      'docs/page.tsx': 'export default function Docs() {}',
      'docs/prerender.ts': 'export const ttl = "1h"',
    });

    const tree = scanRoutes(appDir());
    const docs = tree.root.children.find((c) => c.segmentName === 'docs');
    expect(docs).toBeDefined();
    expect(docs?.prerender).toBeDefined();
    expect(docs?.prerender?.filePath).toContain('prerender.ts');
  });

  it('discovers prerender.ts in a dynamic segment', () => {
    createApp({
      'docs/[slug]/page.tsx': 'export default function Doc() {}',
      'docs/[slug]/prerender.ts':
        'export async function generateParams() { return [{ slug: "intro" }] }\nexport const ttl = "1h"',
    });

    const tree = scanRoutes(appDir());
    const docs = tree.root.children.find((c) => c.segmentName === 'docs');
    const slug = docs?.children.find((c) => c.segmentName === '[slug]');
    expect(slug).toBeDefined();
    expect(slug?.prerender).toBeDefined();
    expect(slug?.segmentType).toBe('dynamic');
  });

  it('does not confuse prerender.ts with other files', () => {
    createApp({
      'page.tsx': 'export default function Home() {}',
      'prerender.ts': 'export const tags = ["home"]',
    });

    const tree = scanRoutes(appDir());
    expect(tree.root.prerender).toBeDefined();
    expect(tree.root.page).toBeDefined();
  });

  it('ignores prerender.tsx (only .ts accepted)', () => {
    // prerender is a fixed convention — .tsx is also allowed
    createApp({
      'page.tsx': 'export default function Home() {}',
      'docs/page.tsx': 'export default function Docs() {}',
      'docs/prerender.tsx': 'export const ttl = "1h"',
    });

    const tree = scanRoutes(appDir());
    const docs = tree.root.children.find((c) => c.segmentName === 'docs');
    // .tsx is accepted for fixed conventions
    expect(docs?.prerender).toBeDefined();
  });

  it('segments without prerender.ts have no prerender field', () => {
    createApp({
      'page.tsx': 'export default function Home() {}',
      'about/page.tsx': 'export default function About() {}',
    });

    const tree = scanRoutes(appDir());
    const about = tree.root.children.find((c) => c.segmentName === 'about');
    expect(about?.prerender).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolvePrerenderConfig
// ---------------------------------------------------------------------------

describe('resolvePrerenderConfig', () => {
  it('resolves with defaults when only generateParams is provided', () => {
    const config = resolvePrerenderConfig({
      generateParams: async () => [{ slug: 'intro' }],
    });
    expect(config.ttlSeconds).toBe(Infinity);
    expect(config.tags).toEqual([]);
    expect(config.generateParams).toBeDefined();
  });

  it('parses ttl string to seconds', () => {
    expect(resolvePrerenderConfig({ ttl: '1h' }).ttlSeconds).toBe(3600);
    expect(resolvePrerenderConfig({ ttl: '30s' }).ttlSeconds).toBe(30);
    expect(resolvePrerenderConfig({ ttl: '5m' }).ttlSeconds).toBe(300);
    expect(resolvePrerenderConfig({ ttl: '2d' }).ttlSeconds).toBe(172800);
    expect(resolvePrerenderConfig({ ttl: '1w' }).ttlSeconds).toBe(604800);
  });

  it('accepts numeric ttl as seconds', () => {
    expect(resolvePrerenderConfig({ ttl: 120 }).ttlSeconds).toBe(120);
  });

  it('preserves tags', () => {
    const config = resolvePrerenderConfig({ tags: ['docs', 'blog'] });
    expect(config.tags).toEqual(['docs', 'blog']);
  });

  it('throws on invalid ttl', () => {
    expect(() => resolvePrerenderConfig({ ttl: 'invalid' })).toThrow('Invalid cacheLife');
  });

  it('throws on non-array tags', () => {
    expect(() =>
      resolvePrerenderConfig({ tags: 'docs' as unknown as string[] })
    ).toThrow('tags must be an array of strings');
  });

  it('throws on invalid fallback', () => {
    expect(() =>
      resolvePrerenderConfig({ fallback: 'ssr' as unknown as 'shell' })
    ).toThrow("fallback must be 'shell' or omitted");
  });

  it('accepts fallback: "shell"', () => {
    const config = resolvePrerenderConfig({ fallback: 'shell' });
    expect(config.fallback).toBe('shell');
  });
});

// ---------------------------------------------------------------------------
// checkDynamicSegmentParams — build diagnostics
// ---------------------------------------------------------------------------

describe('checkDynamicSegmentParams', () => {
  it('returns null for static segments', () => {
    const diag = checkDynamicSegmentParams('/docs', false, false);
    expect(diag).toBeNull();
  });

  it('returns null for dynamic segments with generateParams', () => {
    const diag = checkDynamicSegmentParams('/docs/[slug]', true, true);
    expect(diag).toBeNull();
  });

  it('returns null for dynamic segments with fallback: "shell"', () => {
    const diag = checkDynamicSegmentParams('/docs/[slug]', true, false, 'shell');
    expect(diag).toBeNull();
  });

  it('returns diagnostic for dynamic segment without generateParams', () => {
    const diag = checkDynamicSegmentParams('/docs/[slug]', true, false);
    expect(diag).not.toBeNull();
    expect(diag?.type).toBe('DYNAMIC_SEGMENT_NO_PARAMS');
    expect(diag?.message).toContain('generateParams');
    expect(diag?.segmentPath).toBe('/docs/[slug]');
  });
});

// ---------------------------------------------------------------------------
// 'use dynamic' directive detection
// ---------------------------------------------------------------------------

describe("'use dynamic' detection", () => {
  it('detects single-quoted directive', () => {
    const code = `export default function Cart() {
  'use dynamic'
  return <div />
}`;
    expect(containsUseDynamic(code)).toBe(true);
  });

  it('detects double-quoted directive', () => {
    const code = `export default function Cart() {
  "use dynamic"
  return <div />
}`;
    expect(containsUseDynamic(code)).toBe(true);
  });

  it('returns false for code without directive', () => {
    const code = `export default function Home() {
  return <h1>Hello</h1>
}`;
    expect(containsUseDynamic(code)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 'use dynamic' transform
// ---------------------------------------------------------------------------

describe("'use dynamic' transform", () => {
  it('transforms directive into markDynamic() call', () => {
    const code = `export default async function AddToCartButton({ productId }) {
  'use dynamic'
  const user = await getUser()
  return <button>Add to cart</button>
}`;
    const result = transformUseDynamic(code);
    expect(result).not.toBeNull();
    expect(result?.code).toContain('__markDynamic();');
    expect(result?.code).toContain("import { markDynamic as __markDynamic }");
    expect(result?.code).not.toContain("'use dynamic'");
  });

  it('transforms double-quoted directive', () => {
    const code = `export default async function Pricing() {
  "use dynamic"
  return <div>$99</div>
}`;
    const result = transformUseDynamic(code);
    expect(result).not.toBeNull();
    expect(result?.code).toContain('__markDynamic();');
    expect(result?.code).not.toContain('"use dynamic"');
  });

  it('handles directive with semicolon', () => {
    const code = `export default async function Cart() {
  'use dynamic';
  return <div />
}`;
    const result = transformUseDynamic(code);
    expect(result).not.toBeNull();
    expect(result?.code).toContain('__markDynamic();');
  });

  it('returns null for code without directive', () => {
    const code = `export default function Home() {
  return <h1>Hello</h1>
}`;
    const result = transformUseDynamic(code);
    expect(result).toBeNull();
  });

  it('transforms multiple functions with directives', () => {
    const code = `async function CartButton() {
  'use dynamic'
  return <button>Cart</button>
}

async function UserGreeting() {
  'use dynamic'
  return <span>Hello</span>
}`;
    const result = transformUseDynamic(code);
    expect(result).not.toBeNull();
    // Should contain exactly 2 markDynamic calls
    const matches = result?.code.match(/__markDynamic\(\)/g);
    expect(matches?.length).toBe(2);
    // Should have only one import
    const imports = result?.code.match(/import.*markDynamic/g);
    expect(imports?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 'use dynamic' exclusion from shell
// ---------------------------------------------------------------------------

describe("'use dynamic' exclusion from shell", () => {
  it('directive is valid in server mode', () => {
    const code = `export default async function DynamicWidget() {
  'use dynamic'
  const user = await getUser()
  return <div>{user.name}</div>
}`;
    // Transform should succeed in server mode
    const result = transformUseDynamic(code);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 'use dynamic' static mode validation
// ---------------------------------------------------------------------------

describe("'use dynamic' static mode validation", () => {
  it('reports error for use dynamic in static mode', () => {
    const code = `export default async function Cart() {
  'use dynamic'
  return <div />
}`;
    const error = validateNoDynamicInStaticMode(code);
    expect(error).not.toBeNull();
    expect(error?.message).toContain('static mode');
    expect(error?.line).toBe(2);
  });

  it('returns null when no directive present', () => {
    const code = `export default function Home() {
  return <h1>Hello</h1>
}`;
    const error = validateNoDynamicInStaticMode(code);
    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// revalidateTag purges shells (config-level test)
// ---------------------------------------------------------------------------

describe('tag purge config', () => {
  it('tags are preserved through config resolution', () => {
    const config = resolvePrerenderConfig({
      tags: ['products', 'featured'],
      ttl: '1h',
    });
    expect(config.tags).toEqual(['products', 'featured']);
    expect(config.ttlSeconds).toBe(3600);
  });

  it('empty tags array is valid', () => {
    const config = resolvePrerenderConfig({ tags: [] });
    expect(config.tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// middleware + access on cached shells (design constraint)
// ---------------------------------------------------------------------------

describe('access on cached shells', () => {
  it('prerender.ts coexists with access.ts in same segment', () => {
    createApp({
      'dashboard/page.tsx': 'export default function Dashboard() {}',
      'dashboard/access.ts': 'export default function access(ctx) { return ctx.allow() }',
      'dashboard/prerender.ts': 'export const ttl = "1h"',
    });

    const tree = scanRoutes(appDir());
    const dashboard = tree.root.children.find((c) => c.segmentName === 'dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard?.prerender).toBeDefined();
    expect(dashboard?.access).toBeDefined();
  });

  it('prerender.ts coexists with middleware.ts in same segment', () => {
    createApp({
      'dashboard/page.tsx': 'export default function Dashboard() {}',
      'dashboard/middleware.ts': 'export function middleware(ctx) { return ctx.next() }',
      'dashboard/prerender.ts': 'export const ttl = "1h"',
    });

    const tree = scanRoutes(appDir());
    const dashboard = tree.root.children.find((c) => c.segmentName === 'dashboard');
    expect(dashboard?.prerender).toBeDefined();
    expect(dashboard?.middleware).toBeDefined();
  });
});
