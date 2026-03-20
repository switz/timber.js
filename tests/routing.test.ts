import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { scanRoutes, classifySegment } from '@timber-js/app/routing';

const TMP_DIR = join(import.meta.dirname, '.tmp-routing-test');

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

// --- classifySegment ---

describe('classifySegment', () => {
  it('classifies static segments', () => {
    expect(classifySegment('dashboard')).toEqual({ type: 'static' });
    expect(classifySegment('about')).toEqual({ type: 'static' });
  });

  it('classifies dynamic segments', () => {
    expect(classifySegment('[id]')).toEqual({ type: 'dynamic', paramName: 'id' });
    expect(classifySegment('[slug]')).toEqual({ type: 'dynamic', paramName: 'slug' });
  });

  it('classifies catch-all segments', () => {
    expect(classifySegment('[...slug]')).toEqual({ type: 'catch-all', paramName: 'slug' });
  });

  it('classifies optional catch-all segments', () => {
    expect(classifySegment('[[...slug]]')).toEqual({
      type: 'optional-catch-all',
      paramName: 'slug',
    });
  });

  it('classifies route groups', () => {
    expect(classifySegment('(auth)')).toEqual({ type: 'group' });
    expect(classifySegment('(marketing)')).toEqual({ type: 'group' });
  });

  it('classifies parallel route slots', () => {
    expect(classifySegment('@sidebar')).toEqual({ type: 'slot' });
    expect(classifySegment('@modal')).toEqual({ type: 'slot' });
  });

  it('classifies intercepting routes', () => {
    expect(classifySegment('(.)photo')).toEqual({
      type: 'intercepting',
      interceptionMarker: '(.)',
      interceptedSegmentName: 'photo',
    });
    expect(classifySegment('(..)feed')).toEqual({
      type: 'intercepting',
      interceptionMarker: '(..)',
      interceptedSegmentName: 'feed',
    });
    expect(classifySegment('(...)photos')).toEqual({
      type: 'intercepting',
      interceptionMarker: '(...)',
      interceptedSegmentName: 'photos',
    });
    expect(classifySegment('(..)(..)admin')).toEqual({
      type: 'intercepting',
      interceptionMarker: '(..)(..)',
      interceptedSegmentName: 'admin',
    });
  });

  it('does not confuse route groups with intercepting routes', () => {
    expect(classifySegment('(marketing)')).toEqual({ type: 'group' });
    expect(classifySegment('(auth)')).toEqual({ type: 'group' });
  });
});

// --- scanRoutes: discovers all file conventions ---

describe('scanRoutes', () => {
  it('discovers all file conventions', () => {
    const root = createApp({
      'page.tsx': '',
      'layout.tsx': '',
      'middleware.ts': '',
      'access.ts': '',
      'error.tsx': '',
      'default.tsx': '',
      'denied.tsx': '',
      '404.tsx': '',
      '4xx.tsx': '',
      '5xx.tsx': '',
    });

    const tree = scanRoutes(root);
    const r = tree.root;

    expect(r.page).toBeDefined();
    expect(r.page!.extension).toBe('tsx');
    expect(r.layout).toBeDefined();
    expect(r.middleware).toBeDefined();
    expect(r.access).toBeDefined();
    expect(r.error).toBeDefined();
    expect(r.default).toBeDefined();
    expect(r.denied).toBeDefined();
    expect(r.statusFiles).toBeDefined();
    expect(r.statusFiles!.has('404')).toBe(true);
    expect(r.statusFiles!.has('4xx')).toBe(true);
    expect(r.statusFiles!.has('5xx')).toBe(true);
  });

  it('discovers proxy.ts at app root', () => {
    const root = createApp({
      'proxy.ts': '',
      'page.tsx': '',
    });

    const tree = scanRoutes(root);
    expect(tree.proxy).toBeDefined();
    expect(tree.proxy!.extension).toBe('ts');
  });

  it('builds segment chain', () => {
    const root = createApp({
      'layout.tsx': '',
      'dashboard/layout.tsx': '',
      'dashboard/settings/page.tsx': '',
    });

    const tree = scanRoutes(root);
    expect(tree.root.layout).toBeDefined();

    const dashboard = tree.root.children.find((c) => c.segmentName === 'dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard!.layout).toBeDefined();
    expect(dashboard!.urlPath).toBe('/dashboard');

    const settings = dashboard!.children.find((c) => c.segmentName === 'settings');
    expect(settings).toBeDefined();
    expect(settings!.page).toBeDefined();
    expect(settings!.urlPath).toBe('/dashboard/settings');
  });

  it('identifies leaf route (deepest page.tsx or route.ts)', () => {
    const root = createApp({
      'layout.tsx': '',
      'dashboard/page.tsx': '',
      'api/users/route.ts': '',
    });

    const tree = scanRoutes(root);

    const dashboard = tree.root.children.find((c) => c.segmentName === 'dashboard');
    expect(dashboard!.page).toBeDefined();
    expect(dashboard!.route).toBeUndefined();

    const api = tree.root.children.find((c) => c.segmentName === 'api');
    const users = api!.children.find((c) => c.segmentName === 'users');
    expect(users!.route).toBeDefined();
    expect(users!.page).toBeUndefined();
  });

  it('respects pageExtensions config', () => {
    const root = createApp({
      'page.tsx': '',
      'about/page.mdx': '',
    });

    // Default extensions don't include mdx
    const tree1 = scanRoutes(root);
    const about1 = tree1.root.children.find((c) => c.segmentName === 'about');
    expect(about1!.page).toBeUndefined();

    // With mdx added
    const tree2 = scanRoutes(root, { pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'] });
    const about2 = tree2.root.children.find((c) => c.segmentName === 'about');
    expect(about2!.page).toBeDefined();
    expect(about2!.page!.extension).toBe('mdx');
  });

  it('MDX page extension', () => {
    const root = createApp({
      'docs/getting-started/page.mdx': '',
      'docs/layout.tsx': '',
    });

    const tree = scanRoutes(root, { pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'] });
    const docs = tree.root.children.find((c) => c.segmentName === 'docs');
    expect(docs!.layout).toBeDefined();

    const gettingStarted = docs!.children.find((c) => c.segmentName === 'getting-started');
    expect(gettingStarted!.page).toBeDefined();
    expect(gettingStarted!.page!.extension).toBe('mdx');
  });

  it('route.ts page.tsx collision error', () => {
    const root = createApp({
      'dashboard/route.ts': '',
      'dashboard/page.tsx': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/route\.ts and page\.\* cannot coexist/);
  });

  it('catch-all segments', () => {
    const root = createApp({
      'docs/[...slug]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const docs = tree.root.children.find((c) => c.segmentName === 'docs');
    const catchAll = docs!.children.find((c) => c.segmentName === '[...slug]');
    expect(catchAll).toBeDefined();
    expect(catchAll!.segmentType).toBe('catch-all');
    expect(catchAll!.paramName).toBe('slug');
    expect(catchAll!.page).toBeDefined();
  });

  it('optional catch-all segments', () => {
    const root = createApp({
      'docs/[[...slug]]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const docs = tree.root.children.find((c) => c.segmentName === 'docs');
    const optCatchAll = docs!.children.find((c) => c.segmentName === '[[...slug]]');
    expect(optCatchAll).toBeDefined();
    expect(optCatchAll!.segmentType).toBe('optional-catch-all');
    expect(optCatchAll!.paramName).toBe('slug');
  });

  it('route groups', () => {
    const root = createApp({
      '(auth)/login/page.tsx': '',
      '(auth)/layout.tsx': '',
      '(marketing)/page.tsx': '',
    });

    const tree = scanRoutes(root);

    const authGroup = tree.root.children.find((c) => c.segmentName === '(auth)');
    expect(authGroup).toBeDefined();
    expect(authGroup!.segmentType).toBe('group');
    // Groups don't add URL depth
    expect(authGroup!.urlPath).toBe('/');
    expect(authGroup!.layout).toBeDefined();

    const login = authGroup!.children.find((c) => c.segmentName === 'login');
    expect(login).toBeDefined();
    expect(login!.page).toBeDefined();
    expect(login!.urlPath).toBe('/login');

    const marketingGroup = tree.root.children.find((c) => c.segmentName === '(marketing)');
    expect(marketingGroup).toBeDefined();
    expect(marketingGroup!.page).toBeDefined();
  });

  it('parallel routes', () => {
    const root = createApp({
      'dashboard/layout.tsx': '',
      'dashboard/page.tsx': '',
      'dashboard/@sidebar/page.tsx': '',
      'dashboard/@sidebar/default.tsx': '',
      'dashboard/@modal/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const dashboard = tree.root.children.find((c) => c.segmentName === 'dashboard');
    expect(dashboard).toBeDefined();

    // Slots are in the slots map, not children
    expect(dashboard!.slots.size).toBe(2);
    expect(dashboard!.slots.has('sidebar')).toBe(true);
    expect(dashboard!.slots.has('modal')).toBe(true);

    const sidebar = dashboard!.slots.get('sidebar')!;
    expect(sidebar.segmentType).toBe('slot');
    expect(sidebar.page).toBeDefined();
    expect(sidebar.default).toBeDefined();
    // Slots don't add URL depth
    expect(sidebar.urlPath).toBe('/dashboard');
  });

  it('dynamic segments', () => {
    const root = createApp({
      'products/[id]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const products = tree.root.children.find((c) => c.segmentName === 'products');
    const dynamic = products!.children.find((c) => c.segmentName === '[id]');
    expect(dynamic).toBeDefined();
    expect(dynamic!.segmentType).toBe('dynamic');
    expect(dynamic!.paramName).toBe('id');
    expect(dynamic!.urlPath).toBe('/products/[id]');
    expect(dynamic!.page).toBeDefined();
  });

  it('middleware and access at segment level', () => {
    const root = createApp({
      'dashboard/middleware.ts': '',
      'dashboard/access.ts': '',
      'dashboard/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const dashboard = tree.root.children.find((c) => c.segmentName === 'dashboard');
    expect(dashboard!.middleware).toBeDefined();
    expect(dashboard!.access).toBeDefined();
  });

  it('status code files with specific codes', () => {
    const root = createApp({
      '401.tsx': '',
      '403.tsx': '',
      '429.tsx': '',
      '503.tsx': '',
      '4xx.tsx': '',
      '5xx.tsx': '',
      'page.tsx': '',
    });

    const tree = scanRoutes(root);
    expect(tree.root.statusFiles!.size).toBe(6);
    expect(tree.root.statusFiles!.has('401')).toBe(true);
    expect(tree.root.statusFiles!.has('403')).toBe(true);
    expect(tree.root.statusFiles!.has('429')).toBe(true);
    expect(tree.root.statusFiles!.has('503')).toBe(true);
    expect(tree.root.statusFiles!.has('4xx')).toBe(true);
    expect(tree.root.statusFiles!.has('5xx')).toBe(true);
  });

  it('ignores non-convention files', () => {
    const root = createApp({
      'page.tsx': '',
      'utils.ts': '',
      'helpers.tsx': '',
      'README.md': '',
    });

    const tree = scanRoutes(root);
    expect(tree.root.page).toBeDefined();
    // Non-convention files should not appear anywhere
    expect(tree.root.children.length).toBe(0);
  });

  it('handles empty directories gracefully', () => {
    const root = createApp({
      'empty-dir/.gitkeep': '',
    });

    const tree = scanRoutes(root);
    const emptyDir = tree.root.children.find((c) => c.segmentName === 'empty-dir');
    expect(emptyDir).toBeDefined();
    expect(emptyDir!.page).toBeUndefined();
    expect(emptyDir!.layout).toBeUndefined();
  });

  it('nested dynamic segments', () => {
    const root = createApp({
      'users/[userId]/posts/[postId]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const users = tree.root.children.find((c) => c.segmentName === 'users')!;
    const userId = users.children.find((c) => c.segmentName === '[userId]')!;
    expect(userId.paramName).toBe('userId');
    expect(userId.urlPath).toBe('/users/[userId]');

    const posts = userId.children.find((c) => c.segmentName === 'posts')!;
    const postId = posts.children.find((c) => c.segmentName === '[postId]')!;
    expect(postId.paramName).toBe('postId');
    expect(postId.urlPath).toBe('/users/[userId]/posts/[postId]');
    expect(postId.page).toBeDefined();
  });

  it('middleware and access are always .ts/.tsx, not .mdx', () => {
    const root = createApp({
      'page.tsx': '',
      // These should NOT be recognized even with mdx in pageExtensions
      'dashboard/middleware.mdx': '',
      'dashboard/access.mdx': '',
      'dashboard/route.mdx': '',
      'dashboard/page.tsx': '',
    });

    const tree = scanRoutes(root, { pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'] });
    const dashboard = tree.root.children.find((c) => c.segmentName === 'dashboard')!;
    expect(dashboard.middleware).toBeUndefined();
    expect(dashboard.access).toBeUndefined();
    expect(dashboard.route).toBeUndefined();
  });

  it('slot with nested children', () => {
    const root = createApp({
      'dashboard/layout.tsx': '',
      'dashboard/@sidebar/layout.tsx': '',
      'dashboard/@sidebar/settings/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const dashboard = tree.root.children.find((c) => c.segmentName === 'dashboard')!;
    const sidebar = dashboard.slots.get('sidebar')!;
    expect(sidebar.layout).toBeDefined();
    expect(sidebar.children.length).toBe(1);
    expect(sidebar.children[0].segmentName).toBe('settings');
    expect(sidebar.children[0].page).toBeDefined();
  });

  it('intercepting route directories', () => {
    const root = createApp({
      'feed/page.tsx': '',
      'feed/@modal/(.)photo/[id]/page.tsx': '',
      'feed/@modal/default.tsx': '',
      'photo/[id]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const feed = tree.root.children.find((c) => c.segmentName === 'feed')!;

    // The @modal slot should contain the intercepting route
    const modal = feed.slots.get('modal')!;
    expect(modal.segmentType).toBe('slot');
    expect(modal.default).toBeDefined();

    // The intercepting route is a child of the @modal slot
    const intercepting = modal.children.find((c) => c.segmentName === '(.)photo')!;
    expect(intercepting).toBeDefined();
    expect(intercepting.segmentType).toBe('intercepting');
    expect(intercepting.interceptionMarker).toBe('(.)');
    expect(intercepting.interceptedSegmentName).toBe('photo');
    // Intercepting routes don't add URL depth
    expect(intercepting.urlPath).toBe('/feed');

    // The intercepting route has a dynamic child
    const idSegment = intercepting.children.find((c) => c.segmentName === '[id]')!;
    expect(idSegment).toBeDefined();
    expect(idSegment.segmentType).toBe('dynamic');
    expect(idSegment.page).toBeDefined();
  });

  it('excludes underscore-prefixed private folders from route discovery', () => {
    const root = createApp({
      'page.tsx': '',
      '_components/button.tsx': '',
      '_lib/utils.ts': '',
      '_components/page.tsx': '', // should NOT create a route
      'dashboard/page.tsx': '',
      'dashboard/_helpers/format.ts': '',
    });

    const tree = scanRoutes(root);

    // Private folders should not appear as children
    const privateComponents = tree.root.children.find((c) => c.segmentName === '_components');
    expect(privateComponents).toBeUndefined();

    const privateLib = tree.root.children.find((c) => c.segmentName === '_lib');
    expect(privateLib).toBeUndefined();

    // Normal routes should still work
    const dashboard = tree.root.children.find((c) => c.segmentName === 'dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard!.page).toBeDefined();

    // Nested private folders should also be excluded
    const dashboardHelpers = dashboard!.children.find((c) => c.segmentName === '_helpers');
    expect(dashboardHelpers).toBeUndefined();
  });

  it('classifies underscore-prefixed directories as private (not routable)', () => {
    // classifySegment should return 'private' for underscore-prefixed dirs
    expect(classifySegment('_components')).toEqual({ type: 'private' });
    expect(classifySegment('_lib')).toEqual({ type: 'private' });
    expect(classifySegment('_utils')).toEqual({ type: 'private' });
  });

  it('private folders do not generate metadata routes', () => {
    const root = createApp({
      'page.tsx': '',
      '_private/opengraph-image.tsx': '',
      '_private/icon.png': '',
      'about/opengraph-image.tsx': '',
      'about/page.tsx': '',
    });

    const tree = scanRoutes(root);

    // _private should not appear in the tree at all
    const privateDir = tree.root.children.find((c) => c.segmentName === '_private');
    expect(privateDir).toBeUndefined();

    // Normal segments should still appear
    const about = tree.root.children.find((c) => c.segmentName === 'about');
    expect(about).toBeDefined();
  });

  it('rejects directories with encoded path separators (%2F, %2f)', () => {
    const root = createApp({
      'page.tsx': '',
      'my%2Fpage/page.tsx': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/encoded path delimiter/i);
  });

  it('rejects directories with encoded backslash separators (%5C, %5c)', () => {
    const root = createApp({
      'page.tsx': '',
      'my%5Cpage/page.tsx': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/encoded path delimiter/i);
  });

  it('rejects directories with encoded null bytes (%00)', () => {
    const root = createApp({
      'page.tsx': '',
      'my%00page/page.tsx': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/encoded null byte/i);
  });

  it('rejects encoded path delimiters in nested directories', () => {
    const root = createApp({
      'dashboard/settings%2Fadmin/page.tsx': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/encoded path delimiter/i);
  });

  it('allows normal percent signs that are not dangerous encodings', () => {
    const root = createApp({
      'page.tsx': '',
      '100%/page.tsx': '',
    });

    // Should not throw — "100%" doesn't contain encoded separators or null
    const tree = scanRoutes(root);
    const segment = tree.root.children.find((c) => c.segmentName === '100%');
    expect(segment).toBeDefined();
  });

  // --- Route group collision detection ---

  it('detects route group page collision at same URL path', () => {
    const root = createApp({
      '(auth)/login/page.tsx': '',
      '(marketing)/login/page.tsx': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/route collision/i);
  });

  it('detects route group collision with route.ts', () => {
    const root = createApp({
      '(api)/users/route.ts': '',
      '(internal)/users/route.ts': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/route collision/i);
  });

  it('detects route group collision between page and route.ts at same URL', () => {
    const root = createApp({
      '(web)/about/page.tsx': '',
      '(api)/about/route.ts': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/route collision/i);
  });

  it('detects deeply nested route group collision', () => {
    const root = createApp({
      '(shop)/products/[id]/page.tsx': '',
      '(catalog)/products/[id]/page.tsx': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/route collision/i);
  });

  it('allows route groups with different child paths (no collision)', () => {
    const root = createApp({
      '(auth)/login/page.tsx': '',
      '(auth)/register/page.tsx': '',
      '(marketing)/page.tsx': '',
      '(marketing)/about/page.tsx': '',
    });

    // No collision — different URL paths
    const tree = scanRoutes(root);
    expect(tree.root.children.length).toBe(2);
  });

  it('allows route groups with only layouts (no page collision)', () => {
    const root = createApp({
      '(auth)/layout.tsx': '',
      '(auth)/login/page.tsx': '',
      '(marketing)/layout.tsx': '',
      '(marketing)/about/page.tsx': '',
    });

    // Layouts in different groups at same URL level are fine —
    // only page/route collisions matter
    const tree = scanRoutes(root);
    expect(tree.root.children.length).toBe(2);
  });

  it('detects root-level route group page collision', () => {
    const root = createApp({
      '(auth)/page.tsx': '',
      '(marketing)/page.tsx': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/route collision/i);
  });

  it('collision error message includes file paths', () => {
    const root = createApp({
      '(a)/conflict/page.tsx': '',
      '(b)/conflict/page.tsx': '',
    });

    expect(() => scanRoutes(root)).toThrowError(/\(a\).*conflict|conflict.*\(a\)/);
    expect(() => scanRoutes(root)).toThrowError(/\(b\).*conflict|conflict.*\(b\)/);
  });
});

// --- Static metadata route files ---

describe('static metadata route files', () => {
  it('scans static sitemap.xml in root', () => {
    const root = createApp({
      'page.tsx': '',
      'sitemap.xml': '<?xml version="1.0"?><urlset></urlset>',
    });

    const tree = scanRoutes(root);
    expect(tree.root.metadataRoutes).toBeDefined();
    expect(tree.root.metadataRoutes!.has('sitemap')).toBe(true);
    expect(tree.root.metadataRoutes!.get('sitemap')!.extension).toBe('xml');
  });

  it('scans static robots.txt in root', () => {
    const root = createApp({
      'page.tsx': '',
      'robots.txt': 'User-agent: *\nDisallow:',
    });

    const tree = scanRoutes(root);
    expect(tree.root.metadataRoutes).toBeDefined();
    expect(tree.root.metadataRoutes!.has('robots')).toBe(true);
    expect(tree.root.metadataRoutes!.get('robots')!.extension).toBe('txt');
  });

  it('scans static favicon.ico in root', () => {
    const root = createApp({
      'page.tsx': '',
      'favicon.ico': '\x00\x00\x01\x00', // fake ico data
    });

    const tree = scanRoutes(root);
    expect(tree.root.metadataRoutes).toBeDefined();
    expect(tree.root.metadataRoutes!.has('favicon')).toBe(true);
    expect(tree.root.metadataRoutes!.get('favicon')!.extension).toBe('ico');
  });

  it('scans static icon.png in a segment', () => {
    const root = createApp({
      'page.tsx': '',
      'blog/page.tsx': '',
      'blog/icon.png': '\x89PNG', // fake PNG header
    });

    const tree = scanRoutes(root);
    const blog = tree.root.children.find((c) => c.segmentName === 'blog');
    expect(blog).toBeDefined();
    expect(blog!.metadataRoutes).toBeDefined();
    expect(blog!.metadataRoutes!.has('icon')).toBe(true);
    expect(blog!.metadataRoutes!.get('icon')!.extension).toBe('png');
  });

  it('scans static opengraph-image.png', () => {
    const root = createApp({
      'page.tsx': '',
      'opengraph-image.png': '\x89PNG',
    });

    const tree = scanRoutes(root);
    expect(tree.root.metadataRoutes!.has('opengraph-image')).toBe(true);
    expect(tree.root.metadataRoutes!.get('opengraph-image')!.extension).toBe('png');
  });

  it('scans static manifest.json', () => {
    const root = createApp({
      'page.tsx': '',
      'manifest.json': '{"name": "test"}',
    });

    const tree = scanRoutes(root);
    expect(tree.root.metadataRoutes!.has('manifest')).toBe(true);
    expect(tree.root.metadataRoutes!.get('manifest')!.extension).toBe('json');
  });

  it('dynamic takes precedence over static when both exist', () => {
    const root = createApp({
      'page.tsx': '',
      'sitemap.xml': '<?xml version="1.0"?><urlset></urlset>',
      'sitemap.ts': 'export default function sitemap() { return []; }',
    });

    const tree = scanRoutes(root);
    expect(tree.root.metadataRoutes).toBeDefined();
    const sitemap = tree.root.metadataRoutes!.get('sitemap');
    expect(sitemap).toBeDefined();
    // Dynamic (.ts) should win over static (.xml)
    expect(sitemap!.extension).toBe('ts');
  });

  it('dynamic icon.tsx takes precedence over static icon.png', () => {
    const root = createApp({
      'page.tsx': '',
      'icon.png': '\x89PNG',
      'icon.tsx': 'export default function Icon() { return new Response(); }',
    });

    const tree = scanRoutes(root);
    const icon = tree.root.metadataRoutes!.get('icon');
    expect(icon).toBeDefined();
    expect(icon!.extension).toBe('tsx');
  });

  it('static file is kept when no dynamic counterpart exists', () => {
    const root = createApp({
      'page.tsx': '',
      'favicon.ico': '\x00\x00\x01\x00',
      'sitemap.ts': 'export default function sitemap() { return []; }',
    });

    const tree = scanRoutes(root);
    // favicon only has static form (no dynamic)
    expect(tree.root.metadataRoutes!.get('favicon')!.extension).toBe('ico');
    // sitemap has dynamic form
    expect(tree.root.metadataRoutes!.get('sitemap')!.extension).toBe('ts');
  });
});
