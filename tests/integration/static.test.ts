/**
 * Phase 5 Integration Tests — Static Output & Pre-Rendering
 *
 * Tests the static output mode, noClientJavascript validation, dynamic boundaries,
 * and shell invalidation end-to-end.
 *
 * Each test exercises observable behavior across multiple subsystems:
 *   route scanner → static validation → prerender config → dynamic transform
 *
 * Acceptance criteria from timber-dch.4.3.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { scanRoutes } from '@timber/app/routing';
import { validateStaticMode } from '../../packages/timber-app/src/plugins/static-build';
import {
  resolvePrerenderConfig,
  checkDynamicSegmentParams,
} from '../../packages/timber-app/src/server/prerender';
import {
  transformUseDynamic,
  validateNoDynamicInStaticMode,
} from '../../packages/timber-app/src/plugins/dynamic-transform';

// ─── Test Helpers ───────────────────────────────────────────────────────────

const TMP_DIR = join(import.meta.dirname, '.tmp-static-integration');

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

/**
 * Simulate the full static mode validation pass that the Vite plugin
 * would perform during build: scan routes, then validate every source
 * file for static mode violations.
 */
function validateAppForStaticMode(
  files: Record<string, string>,
  options: { noClientJavascript: boolean } = { noClientJavascript: false }
) {
  const root = createApp(files);
  const tree = scanRoutes(root);

  // Collect all validation errors across files (simulating the plugin's transform hook)
  const errors: Array<{ file: string; errors: ReturnType<typeof validateStaticMode> }> = [];

  for (const [filePath, content] of Object.entries(files)) {
    // Only validate JS/TS files in app/
    if (!/\.[jt]sx?$/.test(filePath)) continue;

    const fileErrors = validateStaticMode(content, `app/${filePath}`, options);
    if (fileErrors.length > 0) {
      errors.push({ file: filePath, errors: fileErrors });
    }

    // Also check for 'use dynamic' in static mode
    const dynamicError = validateNoDynamicInStaticMode(content);
    if (dynamicError) {
      errors.push({
        file: filePath,
        errors: [
          {
            type: 'dynamic-api' as const,
            file: `app/${filePath}`,
            message: dynamicError.message,
            line: dynamicError.line,
          },
        ],
      });
    }
  }

  return { tree, errors, root };
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// static all pages — Static mode renders all pages without validation errors
// ═══════════════════════════════════════════════════════════════════════════

describe('static all pages', () => {
  it('validates a complete static app with no errors', () => {
    const { tree, errors } = validateAppForStaticMode({
      'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
      'about/page.tsx': `export default function About() { return <h1>About</h1> }`,
      'blog/page.tsx': `export default async function Blog() {
        const posts = await getPosts()
        return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
      }`,
    });

    expect(errors).toHaveLength(0);
    expect(tree.root.page).toBeDefined();
    expect(tree.root.children).toHaveLength(2);
  });

  it('discovers all pages in a nested route tree', () => {
    const { tree, errors } = validateAppForStaticMode({
      'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
      'docs/page.tsx': `export default function Docs() { return <h1>Docs</h1> }`,
      'docs/intro/page.tsx': `export default function Intro() { return <h1>Intro</h1> }`,
      'docs/api/page.tsx': `export default function Api() { return <h1>API</h1> }`,
      'blog/page.tsx': `export default function Blog() { return <h1>Blog</h1> }`,
    });

    expect(errors).toHaveLength(0);

    // All segments should be present in the tree
    const docs = tree.root.children.find((c) => c.segmentName === 'docs');
    expect(docs).toBeDefined();
    expect(docs?.page).toBeDefined();
    expect(docs?.children).toHaveLength(2);

    const blog = tree.root.children.find((c) => c.segmentName === 'blog');
    expect(blog).toBeDefined();
    expect(blog?.page).toBeDefined();
  });

  it('validates static pages with prerender.ts configuration', () => {
    const { tree, errors } = validateAppForStaticMode({
      'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
      'docs/page.tsx': `export default function Docs() { return <h1>Docs</h1> }`,
      'docs/prerender.ts': `export const ttl = '1h'\nexport const tags = ['docs']`,
    });

    expect(errors).toHaveLength(0);

    const docs = tree.root.children.find((c) => c.segmentName === 'docs');
    expect(docs?.prerender).toBeDefined();
  });

  it('validates dynamic segments with generateParams', () => {
    const { tree, errors } = validateAppForStaticMode({
      'docs/[slug]/page.tsx': `export default function Doc() { return <h1>Doc</h1> }`,
      'docs/[slug]/prerender.ts': `
        export async function generateParams() {
          return [{ slug: 'intro' }, { slug: 'getting-started' }]
        }
        export const ttl = '1h'
        export const tags = ['docs']
      `,
    });

    expect(errors).toHaveLength(0);

    const docs = tree.root.children.find((c) => c.segmentName === 'docs');
    const slug = docs?.children.find((c) => c.segmentName === '[slug]');
    expect(slug?.segmentType).toBe('dynamic');
    expect(slug?.prerender).toBeDefined();
  });

  it('rejects cookies() in static mode', () => {
    const { errors } = validateAppForStaticMode({
      'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
      'profile/page.tsx': `
        import { cookies } from 'next/headers'
        export default async function Profile() {
          const token = cookies().get('session')
          return <div>{token?.value}</div>
        }
      `,
    });

    expect(errors.length).toBeGreaterThan(0);
    const profileErrors = errors.find((e) => e.file === 'profile/page.tsx');
    expect(profileErrors).toBeDefined();
    expect(profileErrors?.errors[0].type).toBe('dynamic-api');
    expect(profileErrors?.errors[0].message).toContain('cookies()');
  });

  it('rejects headers() in static mode', () => {
    const { errors } = validateAppForStaticMode({
      'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
      'locale/page.tsx': `
        import { headers } from 'next/headers'
        export default async function Locale() {
          const lang = headers().get('accept-language')
          return <div>{lang}</div>
        }
      `,
    });

    expect(errors.length).toBeGreaterThan(0);
    const localeErrors = errors.find((e) => e.file === 'locale/page.tsx');
    expect(localeErrors).toBeDefined();
    expect(localeErrors?.errors[0].type).toBe('dynamic-api');
    expect(localeErrors?.errors[0].message).toContain('headers()');
  });

  it('rejects "use dynamic" in static mode', () => {
    const { errors } = validateAppForStaticMode({
      'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
      'cart/page.tsx': `
        export default async function Cart() {
          'use dynamic'
          return <div>Cart</div>
        }
      `,
    });

    expect(errors.length).toBeGreaterThan(0);
    const cartErrors = errors.find((e) => e.file === 'cart/page.tsx');
    expect(cartErrors).toBeDefined();
    expect(cartErrors?.errors[0].message).toContain('static mode');
  });

  it('allows middleware.ts and access.ts in static mode', () => {
    const { errors } = validateAppForStaticMode({
      'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
      'dashboard/page.tsx': `export default function Dashboard() { return <h1>Dashboard</h1> }`,
      'dashboard/middleware.ts': `export function middleware(ctx) { return ctx.next() }`,
      'dashboard/access.ts': `export default function access(ctx) { return ctx.allow() }`,
    });

    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// nojs rejection — noClientJavascript mode rejects 'use client' and 'use server'
// ═══════════════════════════════════════════════════════════════════════════

describe('nojs rejection', () => {
  it('rejects "use client" in noClientJavascript mode', () => {
    const { errors } = validateAppForStaticMode(
      {
        'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
        'counter/page.tsx': `'use client'\nexport default function Counter() { return <button>+</button> }`,
      },
      { noClientJavascript: true }
    );

    expect(errors.length).toBeGreaterThan(0);
    const counterErrors = errors.find((e) => e.file === 'counter/page.tsx');
    expect(counterErrors).toBeDefined();

    const directiveError = counterErrors?.errors.find((e) => e.type === 'nojs-directive');
    expect(directiveError).toBeDefined();
    expect(directiveError?.message).toContain("'use client'");
    expect(directiveError?.message).toContain('noClientJavascript mode');
  });

  it('rejects "use server" in noClientJavascript mode', () => {
    const { errors } = validateAppForStaticMode(
      {
        'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
        'actions.ts': `'use server'\nexport async function createPost(data) { await db.posts.create(data) }`,
      },
      { noClientJavascript: true }
    );

    expect(errors.length).toBeGreaterThan(0);
    const actionErrors = errors.find((e) => e.file === 'actions.ts');
    expect(actionErrors).toBeDefined();

    const directiveError = actionErrors?.errors.find((e) => e.type === 'nojs-directive');
    expect(directiveError).toBeDefined();
    expect(directiveError?.message).toContain("'use server'");
  });

  it('rejects both client and server directives in the same app', () => {
    const { errors } = validateAppForStaticMode(
      {
        'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
        'counter/page.tsx': `'use client'\nexport default function Counter() { return <button>+</button> }`,
        'actions.ts': `'use server'\nexport async function save(data) {}`,
      },
      { noClientJavascript: true }
    );

    // Both files should have errors
    expect(errors.length).toBe(2);
    const counterFile = errors.find((e) => e.file === 'counter/page.tsx');
    const actionsFile = errors.find((e) => e.file === 'actions.ts');
    expect(counterFile).toBeDefined();
    expect(actionsFile).toBeDefined();
  });

  it('allows server components in noClientJavascript mode', () => {
    const { errors } = validateAppForStaticMode(
      {
        'page.tsx': `export default function Home() { return <h1>Home</h1> }`,
        'about/page.tsx': `
          export default async function About() {
            const data = await fetchAbout()
            return <div>{data.title}</div>
          }
        `,
      },
      { noClientJavascript: true }
    );

    expect(errors).toHaveLength(0);
  });

  it('rejects cookies() and use client together in noClientJavascript mode', () => {
    const { errors } = validateAppForStaticMode(
      {
        'page.tsx': `'use client'
import { cookies } from 'next/headers'
export default function Page() {
  const token = cookies().get('x')
  return <div>{token}</div>
}`,
      },
      { noClientJavascript: true }
    );

    // Should catch both the directive violation and the dynamic API usage
    const pageErrors = errors.find((e) => e.file === 'page.tsx');
    expect(pageErrors).toBeDefined();
    const types = pageErrors?.errors.map((e) => e.type) ?? [];
    expect(types).toContain('nojs-directive');
    expect(types).toContain('dynamic-api');
  });

  it('provides actionable error messages guiding users', () => {
    const { errors } = validateAppForStaticMode(
      {
        'widget.tsx': `'use client'\nexport default function Widget() { return <div /> }`,
      },
      { noClientJavascript: true }
    );

    const widgetErrors = errors.find((e) => e.file === 'widget.tsx');
    const msg = widgetErrors?.errors[0].message ?? '';
    // Error should guide users to understand what noClientJavascript mode means
    expect(msg).toContain('noClientJavascript mode');
    expect(msg).toContain('zero JavaScript');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynamic per-request — Dynamic boundaries render per-request in server mode
// ═══════════════════════════════════════════════════════════════════════════

describe('dynamic per-request', () => {
  it('transforms "use dynamic" to markDynamic() in server mode', () => {
    const code = `export default async function UserGreeting() {
  'use dynamic'
  const user = await getUser()
  return <span>Hello, {user.name}</span>
}`;
    const result = transformUseDynamic(code);
    expect(result).not.toBeNull();
    expect(result?.code).toContain('__markDynamic()');
    expect(result?.code).toContain('import { markDynamic as __markDynamic }');
    expect(result?.code).not.toContain("'use dynamic'");
  });

  it('rejects "use dynamic" in static mode at validation level', () => {
    const code = `export default async function Cart() {
  'use dynamic'
  const items = await getCartItems()
  return <div>{items.length} items</div>
}`;
    const error = validateNoDynamicInStaticMode(code);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("output: 'static'");
    expect(error?.message).toContain('Remove the directive');
  });

  it('transforms multiple dynamic components in a single file', () => {
    const code = `async function CartButton() {
  'use dynamic'
  const user = await getUser()
  return <button>Cart ({user.cartCount})</button>
}

async function UserAvatar() {
  'use dynamic'
  const user = await getUser()
  return <img src={user.avatar} />
}

export default function Header() {
  return <header><CartButton /><UserAvatar /></header>
}`;
    const result = transformUseDynamic(code);
    expect(result).not.toBeNull();

    const markDynamicCalls = result?.code.match(/__markDynamic\(\)/g);
    expect(markDynamicCalls?.length).toBe(2);

    // Only one import statement
    const imports = result?.code.match(/import.*markDynamic/g);
    expect(imports?.length).toBe(1);
  });

  it('dynamic route with prerender.ts resolves config correctly', () => {
    createApp({
      'products/[id]/page.tsx': `export default function Product() { return <h1>Product</h1> }`,
      'products/[id]/prerender.ts': `
        export async function generateParams() {
          return [{ id: '1' }, { id: '2' }, { id: '3' }]
        }
        export const ttl = '30m'
        export const tags = ['products', 'catalog']
      `,
    });

    const tree = scanRoutes(appDir());
    const products = tree.root.children.find((c) => c.segmentName === 'products');
    const idSegment = products?.children.find((c) => c.segmentName === '[id]');

    expect(idSegment?.segmentType).toBe('dynamic');
    expect(idSegment?.prerender).toBeDefined();
  });

  it('dynamic segment without generateParams emits diagnostic', () => {
    const diag = checkDynamicSegmentParams('/products/[id]', true, false);
    expect(diag).not.toBeNull();
    expect(diag?.type).toBe('DYNAMIC_SEGMENT_NO_PARAMS');
    expect(diag?.message).toContain('generateParams');
    expect(diag?.message).toContain('SSR');
  });

  it('dynamic segment with fallback: "shell" suppresses diagnostic', () => {
    const diag = checkDynamicSegmentParams('/products/[id]', true, false, 'shell');
    expect(diag).toBeNull();
  });

  it('static segment does not need generateParams', () => {
    const diag = checkDynamicSegmentParams('/about', false, false);
    expect(diag).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// shell invalidation — Prerender config with TTL and tags for invalidation
// ═══════════════════════════════════════════════════════════════════════════

describe('shell invalidation', () => {
  it('resolves TTL string to seconds', () => {
    const config = resolvePrerenderConfig({ ttl: '1h', tags: ['docs'] });
    expect(config.ttlSeconds).toBe(3600);
  });

  it('defaults TTL to Infinity when not specified', () => {
    const config = resolvePrerenderConfig({});
    expect(config.ttlSeconds).toBe(Infinity);
  });

  it('preserves tags for invalidation', () => {
    const config = resolvePrerenderConfig({
      tags: ['docs', 'blog', 'featured'],
      ttl: '2h',
    });
    expect(config.tags).toEqual(['docs', 'blog', 'featured']);
    expect(config.ttlSeconds).toBe(7200);
  });

  it('resolves full prerender.ts with generateParams, ttl, and tags', () => {
    const generateParams = async () => [{ slug: 'intro' }, { slug: 'api' }];
    const config = resolvePrerenderConfig({
      generateParams,
      ttl: '1h',
      tags: ['docs'],
    });

    expect(config.generateParams).toBe(generateParams);
    expect(config.ttlSeconds).toBe(3600);
    expect(config.tags).toEqual(['docs']);
  });

  it('rejects invalid TTL strings', () => {
    expect(() => resolvePrerenderConfig({ ttl: 'forever' })).toThrow('Invalid cacheLife');
    expect(() => resolvePrerenderConfig({ ttl: '' })).toThrow('Invalid cacheLife');
    expect(() => resolvePrerenderConfig({ ttl: '10x' })).toThrow('Invalid cacheLife');
  });

  it('rejects non-string, non-array tags', () => {
    expect(() => resolvePrerenderConfig({ tags: 'docs' as unknown as string[] })).toThrow(
      'tags must be an array of strings'
    );
  });

  it('rejects invalid fallback values', () => {
    expect(() => resolvePrerenderConfig({ fallback: 'blocking' as unknown as 'shell' })).toThrow(
      "fallback must be 'shell' or omitted"
    );
  });

  it('accepts fallback: "shell" in config', () => {
    const config = resolvePrerenderConfig({ fallback: 'shell' });
    expect(config.fallback).toBe('shell');
  });

  it('supports all TTL duration units', () => {
    expect(resolvePrerenderConfig({ ttl: '30s' }).ttlSeconds).toBe(30);
    expect(resolvePrerenderConfig({ ttl: '5m' }).ttlSeconds).toBe(300);
    expect(resolvePrerenderConfig({ ttl: '1h' }).ttlSeconds).toBe(3600);
    expect(resolvePrerenderConfig({ ttl: '2d' }).ttlSeconds).toBe(172800);
    expect(resolvePrerenderConfig({ ttl: '1w' }).ttlSeconds).toBe(604800);
  });

  it('accepts numeric TTL as raw seconds', () => {
    expect(resolvePrerenderConfig({ ttl: 120 }).ttlSeconds).toBe(120);
  });

  it('route tree connects prerender.ts to access.ts correctly', () => {
    createApp({
      'dashboard/page.tsx': `export default function Dashboard() { return <h1>Dashboard</h1> }`,
      'dashboard/access.ts': `export default function access(ctx) { return ctx.allow() }`,
      'dashboard/prerender.ts': `export const ttl = '30m'\nexport const tags = ['dashboard']`,
    });

    const tree = scanRoutes(appDir());
    const dashboard = tree.root.children.find((c) => c.segmentName === 'dashboard');

    // Both prerender and access should coexist — access always runs fresh
    expect(dashboard?.prerender).toBeDefined();
    expect(dashboard?.access).toBeDefined();
    expect(dashboard?.page).toBeDefined();
  });

  it('route tree connects prerender.ts to middleware.ts correctly', () => {
    createApp({
      'admin/page.tsx': `export default function Admin() { return <h1>Admin</h1> }`,
      'admin/middleware.ts': `export function middleware(ctx) { return ctx.next() }`,
      'admin/prerender.ts': `export const ttl = '1h'\nexport const tags = ['admin']`,
    });

    const tree = scanRoutes(appDir());
    const admin = tree.root.children.find((c) => c.segmentName === 'admin');

    expect(admin?.prerender).toBeDefined();
    expect(admin?.middleware).toBeDefined();
  });

  it('dynamic segment with prerender.ts and generateParams is fully configured', () => {
    createApp({
      'docs/[slug]/page.tsx': `export default function Doc() { return <h1>Doc</h1> }`,
      'docs/[slug]/prerender.ts': `
        export async function generateParams() {
          return [{ slug: 'intro' }, { slug: 'guide' }]
        }
        export const ttl = '1h'
        export const tags = ['docs']
      `,
    });

    const tree = scanRoutes(appDir());
    const docs = tree.root.children.find((c) => c.segmentName === 'docs');
    const slug = docs?.children.find((c) => c.segmentName === '[slug]');

    expect(slug?.segmentType).toBe('dynamic');
    expect(slug?.prerender).toBeDefined();

    // Verify no diagnostic for this properly configured segment
    const diag = checkDynamicSegmentParams(
      '/docs/[slug]',
      true, // isDynamic
      true // hasGenerateParams (prerender.ts has it)
    );
    expect(diag).toBeNull();
  });

  it('reports diagnostic for dynamic segment missing generateParams', () => {
    createApp({
      'products/[id]/page.tsx': `export default function Product() { return <h1>Product</h1> }`,
      'products/[id]/prerender.ts': `export const ttl = '1h'`,
    });

    const tree = scanRoutes(appDir());
    const products = tree.root.children.find((c) => c.segmentName === 'products');
    const id = products?.children.find((c) => c.segmentName === '[id]');

    expect(id?.segmentType).toBe('dynamic');
    expect(id?.prerender).toBeDefined();

    // Without generateParams, should emit diagnostic
    const diag = checkDynamicSegmentParams(
      '/products/[id]',
      true,
      false // no generateParams
    );
    expect(diag).not.toBeNull();
    expect(diag?.type).toBe('DYNAMIC_SEGMENT_NO_PARAMS');
    expect(diag?.message).toContain('SSR at request time');
  });
});
