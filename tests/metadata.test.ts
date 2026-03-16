import { describe, it, expect } from 'vitest';
import {
  resolveMetadata,
  resolveTitle,
  resolveMetadataUrls,
  renderMetadataToElements,
  type SegmentMetadataEntry,
} from '../packages/timber-app/src/server/metadata';
import { buildRouteElement } from '../packages/timber-app/src/server/route-element-builder';
import type { ManifestSegmentNode } from '../packages/timber-app/src/server/route-matcher';
import type { Metadata } from '../packages/timber-app/src/server/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function entry(meta: Metadata, isPage = false): SegmentMetadataEntry {
  return { metadata: meta, isPage };
}

// ─── Static Metadata ──────────────────────────────────────────────────────────

describe('static metadata', () => {
  it('resolves static metadata export', () => {
    const result = resolveMetadata([entry({ title: 'My App', description: 'Welcome' })]);
    expect(result.title).toBe('My App');
    expect(result.description).toBe('Welcome');
  });

  it('resolves metadata with all core fields', () => {
    const result = resolveMetadata([
      entry({
        title: 'Test',
        description: 'A description',
        generator: 'timber.js',
        applicationName: 'MyApp',
        creator: 'Author',
        publisher: 'Publisher',
        keywords: ['react', 'framework'],
        category: 'Technology',
      }),
    ]);
    expect(result.title).toBe('Test');
    expect(result.generator).toBe('timber.js');
    expect(result.keywords).toEqual(['react', 'framework']);
  });
});

// ─── Dynamic Metadata ─────────────────────────────────────────────────────────

describe('dynamic metadata', () => {
  it('resolves async metadata function results', () => {
    // Dynamic metadata() is called by the framework before resolveMetadata.
    // The test validates that the resolved output is correctly merged.
    const result = resolveMetadata([
      entry({ title: { default: 'Store', template: '%s | Store' } }),
      entry(
        {
          title: 'Running Shoes',
          description: 'Best running shoes',
          openGraph: { images: [{ url: '/shoes.jpg', width: 800, height: 600, alt: 'Shoes' }] },
        },
        true
      ),
    ]);
    expect(result.title).toBe('Running Shoes | Store');
    expect(result.description).toBe('Best running shoes');
    expect(result.openGraph?.images).toEqual([
      { url: '/shoes.jpg', width: 800, height: 600, alt: 'Shoes' },
    ]);
  });
});

// ─── Title Templates ──────────────────────────────────────────────────────────

describe('title templates', () => {
  it('applies template from layout to page title', () => {
    const result = resolveMetadata([
      entry({ title: { default: 'My App', template: '%s | My App' } }),
      entry({ title: 'Dashboard' }, true),
    ]);
    expect(result.title).toBe('Dashboard | My App');
  });

  it('uses default title when no child provides title', () => {
    const result = resolveMetadata([
      entry({ title: { default: 'My App', template: '%s | My App' } }),
    ]);
    expect(result.title).toBe('My App');
  });

  it('absolute title skips template', () => {
    const result = resolveMetadata([
      entry({ title: { default: 'My App', template: '%s | My App' } }),
      entry({ title: { absolute: 'Settings' } }, true),
    ]);
    expect(result.title).toBe('Settings');
  });

  it('nested templates — nearest ancestor wins', () => {
    const result = resolveMetadata([
      entry({ title: { default: 'My App', template: '%s | My App' } }),
      entry({ title: { template: '%s — Dashboard | My App' } }),
      entry({ title: 'Overview' }, true),
    ]);
    expect(result.title).toBe('Overview — Dashboard | My App');
  });

  it('no title at all resolves to undefined', () => {
    const result = resolveMetadata([entry({ description: 'No title here' })]);
    expect(result.title).toBeUndefined();
  });
});

// ─── resolveTitle standalone ──────────────────────────────────────────────────

describe('resolveTitle', () => {
  it('returns string title with template applied', () => {
    expect(resolveTitle('Page', '%s | App')).toBe('Page | App');
  });

  it('returns string title without template', () => {
    expect(resolveTitle('Page', undefined)).toBe('Page');
  });

  it('absolute skips template', () => {
    expect(resolveTitle({ absolute: 'Exact' }, '%s | App')).toBe('Exact');
  });

  it('default used as fallback', () => {
    expect(resolveTitle({ default: 'Fallback' }, '%s | App')).toBe('Fallback');
  });

  it('undefined title returns undefined', () => {
    expect(resolveTitle(undefined, '%s | App')).toBeUndefined();
  });
});

// ─── Shallow Merge ────────────────────────────────────────────────────────────

describe('shallow merge', () => {
  it('page metadata wins over layout metadata', () => {
    const result = resolveMetadata([
      entry({
        title: { default: 'App', template: '%s | App' },
        description: 'Layout description',
        openGraph: { title: 'OG Layout', siteName: 'My Site' },
      }),
      entry(
        {
          title: 'Page Title',
          description: 'Page description',
          openGraph: { title: 'OG Page' },
        },
        true
      ),
    ]);
    expect(result.description).toBe('Page description');
    // openGraph is shallow-replaced, not deep-merged
    expect(result.openGraph?.title).toBe('OG Page');
    expect(result.openGraph?.siteName).toBeUndefined();
  });

  it('layout values serve as defaults for missing page keys', () => {
    const result = resolveMetadata([
      entry({
        description: 'Layout desc',
        robots: 'index, follow',
      }),
      entry({ title: 'Page Only' }, true),
    ]);
    expect(result.description).toBe('Layout desc');
    expect(result.robots).toBe('index, follow');
    expect(result.title).toBe('Page Only');
  });

  it('three-level merge: root → nested layout → page', () => {
    const result = resolveMetadata([
      entry({
        title: { default: 'App', template: '%s | App' },
        robots: 'index, follow',
      }),
      entry({
        title: { template: '%s — Blog | App' },
        description: 'Blog section',
      }),
      entry(
        {
          title: 'My Post',
          description: 'Post description',
        },
        true
      ),
    ]);
    expect(result.title).toBe('My Post — Blog | App');
    expect(result.description).toBe('Post description');
    expect(result.robots).toBe('index, follow');
  });
});

// ─── metadataBase ─────────────────────────────────────────────────────────────

describe('metadata base', () => {
  it('resolves relative URLs in openGraph images', () => {
    const result = resolveMetadata([
      entry({ metadataBase: new URL('https://myapp.com') }),
      entry(
        {
          openGraph: { images: '/images/og.jpg' },
        },
        true
      ),
    ]);
    const resolved = resolveMetadataUrls(result);
    expect(resolved.openGraph?.images).toBe('https://myapp.com/images/og.jpg');
  });

  it('resolves relative URLs in alternates', () => {
    const result = resolveMetadata([
      entry({ metadataBase: new URL('https://myapp.com') }),
      entry(
        {
          alternates: { canonical: '/products/123' },
        },
        true
      ),
    ]);
    const resolved = resolveMetadataUrls(result);
    expect(resolved.alternates?.canonical).toBe('https://myapp.com/products/123');
  });

  it('resolves relative URLs in openGraph single-object images', () => {
    const result = resolveMetadata([
      entry({ metadataBase: new URL('https://myapp.com') }),
      entry(
        {
          openGraph: { images: { url: '/images/og.jpg', width: 1200, height: 630 } },
        },
        true
      ),
    ]);
    const resolved = resolveMetadataUrls(result);
    expect(resolved.openGraph?.images).toEqual({
      url: 'https://myapp.com/images/og.jpg',
      width: 1200,
      height: 630,
    });
  });

  it('resolves relative URLs in twitter single-object images', () => {
    const result = resolveMetadata([
      entry({ metadataBase: new URL('https://myapp.com') }),
      entry(
        {
          twitter: { images: { url: '/images/tw.jpg', alt: 'Preview' } },
        },
        true
      ),
    ]);
    const resolved = resolveMetadataUrls(result);
    expect(resolved.twitter?.images).toEqual({
      url: 'https://myapp.com/images/tw.jpg',
      alt: 'Preview',
    });
  });

  it('does not modify absolute URLs', () => {
    const result = resolveMetadata([
      entry({ metadataBase: new URL('https://myapp.com') }),
      entry(
        {
          openGraph: { images: 'https://cdn.example.com/og.jpg' },
        },
        true
      ),
    ]);
    const resolved = resolveMetadataUrls(result);
    expect(resolved.openGraph?.images).toBe('https://cdn.example.com/og.jpg');
  });

  it('works without metadataBase (no resolution)', () => {
    const result = resolveMetadata([
      entry({
        openGraph: { images: '/images/og.jpg' },
      }),
    ]);
    const resolved = resolveMetadataUrls(result);
    expect(resolved.openGraph?.images).toBe('/images/og.jpg');
  });

  it('metadataBase inherits through merge chain', () => {
    const result = resolveMetadata([
      entry({ metadataBase: new URL('https://myapp.com') }),
      entry({}),
      entry(
        {
          alternates: { canonical: '/page' },
        },
        true
      ),
    ]);
    const resolved = resolveMetadataUrls(result);
    expect(resolved.alternates?.canonical).toBe('https://myapp.com/page');
  });
});

// ─── Error State ──────────────────────────────────────────────────────────────

describe('error state noindex', () => {
  it('injects noindex robots for error state', () => {
    const base = resolveMetadata([
      entry({
        title: { default: 'My Store', template: '%s | My Store' },
        robots: 'index, follow',
      }),
    ]);
    // Simulate error state: page metadata lost, noindex injected
    const errorMeta = { ...base, robots: 'noindex' as const };
    expect(errorMeta.robots).toBe('noindex');
    expect(errorMeta.title).toBe('My Store');
  });

  it('resolveMetadata with errorState flag injects noindex', () => {
    const result = resolveMetadata(
      [
        entry({
          title: { default: 'My Store', template: '%s | My Store' },
          robots: 'index, follow',
        }),
        entry({ title: 'Product Page' }, true),
      ],
      { errorState: true }
    );
    expect(result.robots).toBe('noindex');
    // In error state, page title is lost — should fall back to layout default
    expect(result.title).toBe('My Store');
  });
});

// ─── Metadata Routes ──────────────────────────────────────────────────────────

describe('metadata routes proxy only', () => {
  // Metadata routes run through proxy.ts but NOT middleware or access gates.
  // This is tested at the pipeline level. Here we test the route classification.
  it('metadata route files are recognized', async () => {
    const { classifyMetadataRoute } =
      await import('../packages/timber-app/src/server/metadata-routes');
    expect(classifyMetadataRoute('sitemap.xml')).toEqual({
      type: 'sitemap',
      contentType: 'application/xml',
      nestable: true,
    });
    expect(classifyMetadataRoute('robots.txt')).toEqual({
      type: 'robots',
      contentType: 'text/plain',
      nestable: false,
    });
    expect(classifyMetadataRoute('manifest.json')).toEqual({
      type: 'manifest',
      contentType: 'application/manifest+json',
      nestable: false,
    });
    expect(classifyMetadataRoute('favicon.ico')).toEqual({
      type: 'favicon',
      contentType: 'image/x-icon',
      nestable: false,
    });
  });

  it('dynamic metadata route files are recognized', async () => {
    const { classifyMetadataRoute } =
      await import('../packages/timber-app/src/server/metadata-routes');
    expect(classifyMetadataRoute('sitemap.ts')).toEqual({
      type: 'sitemap',
      contentType: 'application/xml',
      nestable: true,
    });
    expect(classifyMetadataRoute('robots.ts')).toEqual({
      type: 'robots',
      contentType: 'text/plain',
      nestable: false,
    });
    expect(classifyMetadataRoute('icon.tsx')).toEqual({
      type: 'icon',
      contentType: 'image/*',
      nestable: true,
    });
    expect(classifyMetadataRoute('opengraph-image.tsx')).toEqual({
      type: 'opengraph-image',
      contentType: 'image/*',
      nestable: true,
    });
  });

  it('non-metadata files return null', async () => {
    const { classifyMetadataRoute } =
      await import('../packages/timber-app/src/server/metadata-routes');
    expect(classifyMetadataRoute('page.tsx')).toBeNull();
    expect(classifyMetadataRoute('layout.tsx')).toBeNull();
    expect(classifyMetadataRoute('random.ts')).toBeNull();
  });
});

// ─── Image Response ───────────────────────────────────────────────────────────

describe('image response', () => {
  it('ImageResponse re-export type exists', async () => {
    // We just verify the module exports the type reference
    const mod = await import('../packages/timber-app/src/server/metadata-routes');
    expect(mod.METADATA_ROUTE_CONVENTIONS).toBeDefined();
  });
});

// ─── renderMetadataToElements ─────────────────────────────────────────────────

describe('renderMetadataToElements', () => {
  it('renders title and description', () => {
    const elements = renderMetadataToElements({
      title: 'My Page',
      description: 'A great page',
    });
    expect(elements).toContainEqual({ tag: 'title', content: 'My Page' });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'description', content: 'A great page' },
    });
  });

  it('renders openGraph tags', () => {
    const elements = renderMetadataToElements({
      openGraph: { title: 'OG Title', description: 'OG Desc', type: 'website' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'og:title', content: 'OG Title' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'og:description', content: 'OG Desc' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'og:type', content: 'website' },
    });
  });

  it('renders openGraph images as single object', () => {
    const elements = renderMetadataToElements({
      openGraph: {
        images: { url: '/og.png', width: 1200, height: 630, alt: 'Preview' },
      },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'og:image', content: '/og.png' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'og:image:width', content: '1200' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'og:image:height', content: '630' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'og:image:alt', content: 'Preview' },
    });
  });

  it('renders twitter tags', () => {
    const elements = renderMetadataToElements({
      twitter: { card: 'summary_large_image', title: 'Tweet', creator: '@user' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:card', content: 'summary_large_image' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:title', content: 'Tweet' },
    });
  });

  it('renders twitter images as single object', () => {
    const elements = renderMetadataToElements({
      twitter: { images: { url: '/tw.png', alt: 'Twitter preview' } },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:image', content: '/tw.png' },
    });
  });

  it('renders robots as string', () => {
    const elements = renderMetadataToElements({ robots: 'noindex, nofollow' });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'robots', content: 'noindex, nofollow' },
    });
  });

  it('renders robots object', () => {
    const elements = renderMetadataToElements({
      robots: { index: false, follow: true },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'robots', content: 'noindex, follow' },
    });
  });

  it('renders icon links', () => {
    const elements = renderMetadataToElements({
      icons: { icon: '/favicon.png' },
    });
    expect(elements).toContainEqual({
      tag: 'link',
      attrs: { rel: 'icon', href: '/favicon.png' },
    });
  });

  it('renders manifest link', () => {
    const elements = renderMetadataToElements({ manifest: '/manifest.webmanifest' });
    expect(elements).toContainEqual({
      tag: 'link',
      attrs: { rel: 'manifest', href: '/manifest.webmanifest' },
    });
  });

  it('renders alternates canonical', () => {
    const elements = renderMetadataToElements({
      alternates: { canonical: 'https://example.com/page' },
    });
    expect(elements).toContainEqual({
      tag: 'link',
      attrs: { rel: 'canonical', href: 'https://example.com/page' },
    });
  });

  it('renders verification tags', () => {
    const elements = renderMetadataToElements({
      verification: { google: 'abc123' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'google-site-verification', content: 'abc123' },
    });
  });

  it('renders keywords', () => {
    const elements = renderMetadataToElements({
      keywords: ['react', 'framework'],
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'keywords', content: 'react, framework' },
    });
  });

  it('renders root-level authors', () => {
    const elements = renderMetadataToElements({
      authors: [{ name: 'Alice', url: 'https://alice.dev' }],
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'author', content: 'Alice' },
    });
    expect(elements).toContainEqual({
      tag: 'link',
      attrs: { rel: 'author', href: 'https://alice.dev' },
    });
  });

  it('renders single author object', () => {
    const elements = renderMetadataToElements({
      authors: { name: 'Bob' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'author', content: 'Bob' },
    });
  });

  it('renders appleWebApp meta tags', () => {
    const elements = renderMetadataToElements({
      appleWebApp: {
        capable: true,
        title: 'My PWA',
        statusBarStyle: 'black-translucent',
      },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'apple-mobile-web-app-title', content: 'My PWA' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    });
  });

  it('renders appleWebApp startup images', () => {
    const elements = renderMetadataToElements({
      appleWebApp: {
        startupImage: [
          { url: '/splash-1.png', media: '(device-width: 375px)' },
          { url: '/splash-2.png' },
        ],
      },
    });
    expect(elements).toContainEqual({
      tag: 'link',
      attrs: {
        rel: 'apple-touch-startup-image',
        href: '/splash-1.png',
        media: '(device-width: 375px)',
      },
    });
    expect(elements).toContainEqual({
      tag: 'link',
      attrs: { rel: 'apple-touch-startup-image', href: '/splash-2.png' },
    });
  });

  it('renders appleWebApp with string startupImage', () => {
    const elements = renderMetadataToElements({
      appleWebApp: { startupImage: '/splash.png' },
    });
    expect(elements).toContainEqual({
      tag: 'link',
      attrs: { rel: 'apple-touch-startup-image', href: '/splash.png' },
    });
  });

  it('renders formatDetection', () => {
    const elements = renderMetadataToElements({
      formatDetection: { telephone: false, email: false },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'format-detection', content: 'telephone=no, email=no' },
    });
  });

  // --- App Links ---

  it('renders appLinks iOS tags', () => {
    const elements = renderMetadataToElements({
      appLinks: {
        ios: [{ url: 'myapp://product/123', app_store_id: '123456', app_name: 'My App' }],
      },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'al:ios:url', content: 'myapp://product/123' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'al:ios:app_store_id', content: '123456' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'al:ios:app_name', content: 'My App' },
    });
  });

  it('renders appLinks Android tags', () => {
    const elements = renderMetadataToElements({
      appLinks: {
        android: [{ url: 'myapp://product/123', package: 'com.example.app', app_name: 'My App' }],
      },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'al:android:url', content: 'myapp://product/123' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'al:android:package', content: 'com.example.app' },
    });
  });

  it('renders appLinks web fallback', () => {
    const elements = renderMetadataToElements({
      appLinks: {
        web: { url: 'https://example.com/product/123', shouldFallback: true },
      },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'al:web:url', content: 'https://example.com/product/123' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { property: 'al:web:should_fallback', content: 'true' },
    });
  });

  // --- iTunes ---

  it('renders apple-itunes-app meta tag', () => {
    const elements = renderMetadataToElements({
      itunes: { appId: '123456789', appArgument: 'myapp://product/123' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: {
        name: 'apple-itunes-app',
        content: 'app-id=123456789, app-argument=myapp://product/123',
      },
    });
  });

  it('renders itunes with affiliate data', () => {
    const elements = renderMetadataToElements({
      itunes: { appId: '123456789', affiliateData: 'ct=banner' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: {
        name: 'apple-itunes-app',
        content: 'app-id=123456789, affiliate-data=ct=banner',
      },
    });
  });

  // --- Twitter Player Card ---

  it('renders twitter player card tags', () => {
    const elements = renderMetadataToElements({
      twitter: {
        card: 'player',
        players: [
          {
            playerUrl: 'https://example.com/player',
            streamUrl: 'https://example.com/stream.mp4',
            width: 640,
            height: 480,
          },
        ],
      },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:card', content: 'player' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:player', content: 'https://example.com/player' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:player:width', content: '640' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:player:height', content: '480' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:player:stream', content: 'https://example.com/stream.mp4' },
    });
  });

  // --- Twitter App Card ---

  it('renders twitter app card tags', () => {
    const elements = renderMetadataToElements({
      twitter: {
        card: 'app',
        app: {
          name: 'My App',
          id: { iPhone: '123', iPad: '456', googlePlay: 'com.example.app' },
          url: {
            iPhone: 'myapp://home',
            iPad: 'myapp://home',
            googlePlay: 'https://play.google.com/store/apps/details?id=com.example.app',
          },
        },
      },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:card', content: 'app' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:app:name:iphone', content: 'My App' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:app:id:iphone', content: '123' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:app:url:iphone', content: 'myapp://home' },
    });
    expect(elements).toContainEqual({
      tag: 'meta',
      attrs: { name: 'twitter:app:id:googleplay', content: 'com.example.app' },
    });
  });
});

// ─── Auto-Linking Metadata Routes ─────────────────────────────────────────────

describe('metadata route auto-linking', () => {
  it('getMetadataRouteAutoLink returns link for icon', async () => {
    const { getMetadataRouteAutoLink } =
      await import('../packages/timber-app/src/server/metadata-routes');
    expect(getMetadataRouteAutoLink('icon', '/icon')).toEqual({
      rel: 'icon',
      href: '/icon',
    });
  });

  it('getMetadataRouteAutoLink returns link for apple-icon', async () => {
    const { getMetadataRouteAutoLink } =
      await import('../packages/timber-app/src/server/metadata-routes');
    expect(getMetadataRouteAutoLink('apple-icon', '/apple-icon')).toEqual({
      rel: 'apple-touch-icon',
      href: '/apple-icon',
    });
  });

  it('getMetadataRouteAutoLink returns link for manifest', async () => {
    const { getMetadataRouteAutoLink } =
      await import('../packages/timber-app/src/server/metadata-routes');
    expect(getMetadataRouteAutoLink('manifest', '/manifest.webmanifest')).toEqual({
      rel: 'manifest',
      href: '/manifest.webmanifest',
    });
  });

  it('getMetadataRouteAutoLink returns null for sitemap/robots/opengraph/twitter', async () => {
    const { getMetadataRouteAutoLink } =
      await import('../packages/timber-app/src/server/metadata-routes');
    expect(getMetadataRouteAutoLink('sitemap', '/sitemap.xml')).toBeNull();
    expect(getMetadataRouteAutoLink('robots', '/robots.txt')).toBeNull();
    expect(getMetadataRouteAutoLink('opengraph-image', '/opengraph-image')).toBeNull();
    expect(getMetadataRouteAutoLink('twitter-image', '/twitter-image')).toBeNull();
  });

  /** Create a minimal segment node for testing. */
  function makeSegment(overrides: Partial<ManifestSegmentNode> = {}): ManifestSegmentNode {
    return {
      urlPath: '/',
      children: [],
      slots: {},
      ...overrides,
    } as ManifestSegmentNode;
  }

  it('auto-links icon.png from root segment', async () => {
    const segment = makeSegment({
      page: {
        filePath: 'app/page.tsx',
        load: async () => ({ default: () => 'Hello' }),
      },
      metadataRoutes: {
        icon: {
          filePath: 'app/icon.png',
          load: async () => ({}),
        },
      },
    });

    const result = await buildRouteElement(new Request('http://localhost/'), {
      segments: [segment] as never,
      params: {},
    });
    expect(result.headElements).toContainEqual({
      tag: 'link',
      attrs: { rel: 'icon', href: '/icon' },
    });
  });

  it('auto-links apple-icon from root segment', async () => {
    const segment = makeSegment({
      page: {
        filePath: 'app/page.tsx',
        load: async () => ({ default: () => 'Hello' }),
      },
      metadataRoutes: {
        'apple-icon': {
          filePath: 'app/apple-icon.png',
          load: async () => ({}),
        },
      },
    });

    const result = await buildRouteElement(new Request('http://localhost/'), {
      segments: [segment] as never,
      params: {},
    });
    expect(result.headElements).toContainEqual({
      tag: 'link',
      attrs: { rel: 'apple-touch-icon', href: '/apple-icon' },
    });
  });

  it('auto-links manifest from root segment', async () => {
    const segment = makeSegment({
      page: {
        filePath: 'app/page.tsx',
        load: async () => ({ default: () => 'Hello' }),
      },
      metadataRoutes: {
        manifest: {
          filePath: 'app/manifest.json',
          load: async () => ({}),
        },
      },
    });

    const result = await buildRouteElement(new Request('http://localhost/'), {
      segments: [segment] as never,
      params: {},
    });
    expect(result.headElements).toContainEqual({
      tag: 'link',
      attrs: { rel: 'manifest', href: '/manifest.webmanifest' },
    });
  });

  it('auto-links nestable icon from nested segment', async () => {
    const root = makeSegment({
      layout: {
        filePath: 'app/layout.tsx',
        load: async () => ({ default: ({ children }: { children: unknown }) => children }),
      },
    });
    const nested = makeSegment({
      segmentName: 'blog',
      urlPath: '/blog',
      page: {
        filePath: 'app/blog/page.tsx',
        load: async () => ({ default: () => 'Blog' }),
      },
      metadataRoutes: {
        icon: {
          filePath: 'app/blog/icon.png',
          load: async () => ({}),
        },
      },
    });

    const result = await buildRouteElement(new Request('http://localhost/blog'), {
      segments: [root, nested] as never,
      params: {},
    });
    expect(result.headElements).toContainEqual({
      tag: 'link',
      attrs: { rel: 'icon', href: '/blog/icon' },
    });
  });

  it('does NOT auto-link sitemap or robots', async () => {
    const segment = makeSegment({
      page: {
        filePath: 'app/page.tsx',
        load: async () => ({ default: () => 'Hello' }),
      },
      metadataRoutes: {
        sitemap: {
          filePath: 'app/sitemap.xml',
          load: async () => ({}),
        },
        robots: {
          filePath: 'app/robots.txt',
          load: async () => ({}),
        },
      },
    });

    const result = await buildRouteElement(new Request('http://localhost/'), {
      segments: [segment] as never,
      params: {},
    });
    const linkElements = result.headElements.filter(
      (el) => el.tag === 'link' && (el.attrs?.rel === 'sitemap' || el.attrs?.rel === 'robots')
    );
    expect(linkElements).toHaveLength(0);
  });

  it('does NOT auto-link opengraph-image or twitter-image', async () => {
    const segment = makeSegment({
      page: {
        filePath: 'app/page.tsx',
        load: async () => ({ default: () => 'Hello' }),
      },
      metadataRoutes: {
        'opengraph-image': {
          filePath: 'app/opengraph-image.tsx',
          load: async () => ({}),
        },
        'twitter-image': {
          filePath: 'app/twitter-image.tsx',
          load: async () => ({}),
        },
      },
    });

    const result = await buildRouteElement(new Request('http://localhost/'), {
      segments: [segment] as never,
      params: {},
    });
    const linkElements = result.headElements.filter(
      (el) =>
        el.tag === 'link' &&
        (el.attrs?.href === '/opengraph-image' || el.attrs?.href === '/twitter-image')
    );
    expect(linkElements).toHaveLength(0);
  });
});

// ─── Unified metadata export validation ──────────────────────────────────────

describe('unified metadata export', () => {
  /** Create a minimal segment node for testing. */
  function makeSegment(overrides: Partial<ManifestSegmentNode> = {}): ManifestSegmentNode {
    return {
      urlPath: '/',
      children: [],
      slots: {},
      ...overrides,
    } as ManifestSegmentNode;
  }

  it('rejects generateMetadata export on page', async () => {
    const segment = makeSegment({
      page: {
        filePath: 'app/products/[id]/page.tsx',
        load: async () => ({
          default: () => null,
          generateMetadata: async () => ({ title: 'Test' }),
        }),
      },
    });

    await expect(
      buildRouteElement(new Request('http://localhost/'), {
        segments: [segment] as never,
        params: {},
      })
    ).rejects.toThrow('"generateMetadata" is not a valid export');
  });

  it('rejects generateMetadata export on layout', async () => {
    const segment = makeSegment({
      layout: {
        filePath: 'app/layout.tsx',
        load: async () => ({
          default: () => null,
          generateMetadata: async () => ({ title: 'Test' }),
        }),
      },
      page: {
        filePath: 'app/page.tsx',
        load: async () => ({ default: () => null }),
      },
    });

    await expect(
      buildRouteElement(new Request('http://localhost/'), {
        segments: [segment] as never,
        params: {},
      })
    ).rejects.toThrow('"generateMetadata" is not a valid export');
  });

  it('error message includes file path', async () => {
    const segment = makeSegment({
      page: {
        filePath: 'app/blog/[slug]/page.tsx',
        load: async () => ({
          default: () => null,
          generateMetadata: async () => ({ title: 'Test' }),
        }),
      },
    });

    await expect(
      buildRouteElement(new Request('http://localhost/'), {
        segments: [segment] as never,
        params: {},
      })
    ).rejects.toThrow('app/blog/[slug]/page.tsx');
  });

  it('accepts static metadata object', async () => {
    const segment = makeSegment({
      page: {
        filePath: 'app/page.tsx',
        load: async () => ({
          default: () => 'Hello',
          metadata: { title: 'Static Title' },
        }),
      },
    });

    const result = await buildRouteElement(new Request('http://localhost/'), {
      segments: [segment] as never,
      params: {},
    });
    expect(result.headElements).toContainEqual({ tag: 'title', content: 'Static Title' });
  });

  it('accepts dynamic metadata function', async () => {
    const segment = makeSegment({
      page: {
        filePath: 'app/page.tsx',
        load: async () => ({
          default: () => 'Hello',
          metadata: async () => ({ title: 'Dynamic Title' }),
        }),
      },
    });

    const result = await buildRouteElement(new Request('http://localhost/'), {
      segments: [segment] as never,
      params: {},
    });
    expect(result.headElements).toContainEqual({ tag: 'title', content: 'Dynamic Title' });
  });
});
