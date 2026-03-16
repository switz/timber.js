import { describe, it, expect } from 'vitest';
import {
  createRouteMatcher,
  createMetadataRouteMatcher,
  type ManifestSegmentNode,
  type ManifestRoot,
} from '../packages/timber-app/src/server/route-matcher';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dummyFile = { load: async () => ({}), filePath: 'test.tsx' };

function makeNode(overrides: Partial<ManifestSegmentNode>): ManifestSegmentNode {
  return {
    segmentName: '',
    segmentType: 'static',
    urlPath: '/',
    children: [],
    slots: {},
    ...overrides,
  };
}

function makeManifest(root: ManifestSegmentNode): ManifestRoot {
  return { root };
}

// ─── Catch-all param values ──────────────────────────────────────────────────

describe('route-matcher: catch-all params', () => {
  it('catch-all returns string[] for matched segments', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'docs',
          segmentType: 'static',
          urlPath: '/docs',
          children: [
            makeNode({
              segmentName: '[...slug]',
              segmentType: 'catch-all',
              urlPath: '/docs/[...slug]',
              paramName: 'slug',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));

    const result = match('/docs/a/b/c');
    expect(result).not.toBeNull();
    expect(result!.params.slug).toEqual(['a', 'b', 'c']);
  });

  it('catch-all returns single-element string[] for one segment', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'docs',
          segmentType: 'static',
          urlPath: '/docs',
          children: [
            makeNode({
              segmentName: '[...slug]',
              segmentType: 'catch-all',
              urlPath: '/docs/[...slug]',
              paramName: 'slug',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));

    const result = match('/docs/hello');
    expect(result).not.toBeNull();
    expect(result!.params.slug).toEqual(['hello']);
  });

  it('catch-all does not match zero segments', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'docs',
          segmentType: 'static',
          urlPath: '/docs',
          children: [
            makeNode({
              segmentName: '[...slug]',
              segmentType: 'catch-all',
              urlPath: '/docs/[...slug]',
              paramName: 'slug',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));
    expect(match('/docs')).toBeNull();
  });

  it('catch-all receives already-decoded segments (no double-decode)', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'docs',
          segmentType: 'static',
          urlPath: '/docs',
          children: [
            makeNode({
              segmentName: '[...slug]',
              segmentType: 'catch-all',
              urlPath: '/docs/[...slug]',
              paramName: 'slug',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));

    // Input is already canonical (decoded by canonicalize()) — matcher must not decode again
    const result = match('/docs/hello world/foo+bar');
    expect(result).not.toBeNull();
    expect(result!.params.slug).toEqual(['hello world', 'foo+bar']);
  });
});

// ─── Optional catch-all param values ─────────────────────────────────────────

describe('route-matcher: optional catch-all params', () => {
  it('optional catch-all with no segments → param is undefined', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'docs',
          segmentType: 'static',
          urlPath: '/docs',
          children: [
            makeNode({
              segmentName: '[[...slug]]',
              segmentType: 'optional-catch-all',
              urlPath: '/docs/[[...slug]]',
              paramName: 'slug',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));

    const result = match('/docs');
    expect(result).not.toBeNull();
    expect(result!.params.slug).toBeUndefined();
  });

  it('optional catch-all with segments → param is string[]', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'docs',
          segmentType: 'static',
          urlPath: '/docs',
          children: [
            makeNode({
              segmentName: '[[...slug]]',
              segmentType: 'optional-catch-all',
              urlPath: '/docs/[[...slug]]',
              paramName: 'slug',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));

    const result = match('/docs/a/b');
    expect(result).not.toBeNull();
    expect(result!.params.slug).toEqual(['a', 'b']);
  });

  it('optional catch-all with single segment → param is single-element string[]', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'docs',
          segmentType: 'static',
          urlPath: '/docs',
          children: [
            makeNode({
              segmentName: '[[...slug]]',
              segmentType: 'optional-catch-all',
              urlPath: '/docs/[[...slug]]',
              paramName: 'slug',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));

    const result = match('/docs/hello');
    expect(result).not.toBeNull();
    expect(result!.params.slug).toEqual(['hello']);
  });
});

// ─── No double-decode (timber-dh7) ──────────────────────────────────────────

describe('route-matcher: no double-decode on canonical paths', () => {
  it('dynamic param preserves literal percent-encoded values from canonicalize', () => {
    // /user/%2561dmin → canonicalize decodes to /user/%61dmin
    // The matcher must NOT decode %61 → 'a', producing 'admin'
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'user',
          segmentType: 'static',
          urlPath: '/user',
          children: [
            makeNode({
              segmentName: '[name]',
              segmentType: 'dynamic',
              urlPath: '/user/[name]',
              paramName: 'name',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));

    // After canonicalize: %2561 → %61 (single decode). Matcher receives '%61dmin'.
    const result = match('/user/%61dmin');
    expect(result).not.toBeNull();
    expect(result!.params.name).toBe('%61dmin');
    // Must NOT be 'admin' (double-decode)
    expect(result!.params.name).not.toBe('admin');
  });

  it('catch-all preserves literal percent-encoded values', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'docs',
          segmentType: 'static',
          urlPath: '/docs',
          children: [
            makeNode({
              segmentName: '[...slug]',
              segmentType: 'catch-all',
              urlPath: '/docs/[...slug]',
              paramName: 'slug',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));

    const result = match('/docs/%61dmin/page');
    expect(result).not.toBeNull();
    expect(result!.params.slug).toEqual(['%61dmin', 'page']);
  });

  it('optional catch-all preserves literal percent-encoded values', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'docs',
          segmentType: 'static',
          urlPath: '/docs',
          children: [
            makeNode({
              segmentName: '[[...slug]]',
              segmentType: 'optional-catch-all',
              urlPath: '/docs/[[...slug]]',
              paramName: 'slug',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));

    const result = match('/docs/%61dmin');
    expect(result).not.toBeNull();
    expect(result!.params.slug).toEqual(['%61dmin']);
  });
});

// ─── Dynamic params remain strings ──────────────────────────────────────────

describe('route-matcher: dynamic params', () => {
  it('dynamic segment param is a string', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'users',
          segmentType: 'static',
          urlPath: '/users',
          children: [
            makeNode({
              segmentName: '[id]',
              segmentType: 'dynamic',
              urlPath: '/users/[id]',
              paramName: 'id',
              page: dummyFile,
            }),
          ],
        }),
      ],
    });

    const match = createRouteMatcher(makeManifest(root));

    const result = match('/users/42');
    expect(result).not.toBeNull();
    expect(result!.params.id).toBe('42');
    expect(typeof result!.params.id).toBe('string');
  });
});

// ─── Metadata route matching ────────────────────────────────────────────────

describe('metadata route matcher', () => {
  it('matches root sitemap.xml', () => {
    const root = makeNode({
      metadataRoutes: {
        sitemap: { load: async () => ({}), filePath: 'app/sitemap.ts' },
      },
    });

    const match = createMetadataRouteMatcher(makeManifest(root));
    const result = match('/sitemap.xml');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('sitemap');
    expect(result!.contentType).toBe('application/xml');
  });

  it('matches root robots.txt', () => {
    const root = makeNode({
      metadataRoutes: {
        robots: { load: async () => ({}), filePath: 'app/robots.ts' },
      },
    });

    const match = createMetadataRouteMatcher(makeManifest(root));
    const result = match('/robots.txt');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('robots');
    expect(result!.contentType).toBe('text/plain');
  });

  it('matches nested sitemap.xml', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'blog',
          segmentType: 'static',
          urlPath: '/blog',
          metadataRoutes: {
            sitemap: { load: async () => ({}), filePath: 'app/blog/sitemap.ts' },
          },
        }),
      ],
    });

    const match = createMetadataRouteMatcher(makeManifest(root));
    const result = match('/blog/sitemap.xml');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('sitemap');
  });

  it('does not match non-nestable route in nested segment', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'blog',
          segmentType: 'static',
          urlPath: '/blog',
          metadataRoutes: {
            robots: { load: async () => ({}), filePath: 'app/blog/robots.ts' },
          },
        }),
      ],
    });

    const match = createMetadataRouteMatcher(makeManifest(root));
    // robots.txt is non-nestable — should not match from /blog
    expect(match('/blog/robots.txt')).toBeNull();
  });

  it('returns null for unrecognized paths', () => {
    const root = makeNode({
      metadataRoutes: {
        sitemap: { load: async () => ({}), filePath: 'app/sitemap.ts' },
      },
    });

    const match = createMetadataRouteMatcher(makeManifest(root));
    expect(match('/about')).toBeNull();
    expect(match('/sitemap')).toBeNull();
  });

  it('matches opengraph-image', () => {
    const root = makeNode({
      metadataRoutes: {
        'opengraph-image': { load: async () => ({}), filePath: 'app/opengraph-image.tsx' },
      },
    });

    const match = createMetadataRouteMatcher(makeManifest(root));
    const result = match('/opengraph-image');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('opengraph-image');
  });

  it('matches manifest.webmanifest', () => {
    const root = makeNode({
      metadataRoutes: {
        manifest: { load: async () => ({}), filePath: 'app/manifest.ts' },
      },
    });

    const match = createMetadataRouteMatcher(makeManifest(root));
    const result = match('/manifest.webmanifest');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('manifest');
    expect(result!.contentType).toBe('application/manifest+json');
  });

  it('matches icon in nested segment', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: 'blog',
          segmentType: 'static',
          urlPath: '/blog',
          metadataRoutes: {
            icon: { load: async () => ({}), filePath: 'app/blog/icon.tsx' },
          },
        }),
      ],
    });

    const match = createMetadataRouteMatcher(makeManifest(root));
    const result = match('/blog/icon');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('icon');
  });

  it('matches metadata routes inside group segments', () => {
    const root = makeNode({
      children: [
        makeNode({
          segmentName: '(marketing)',
          segmentType: 'group',
          urlPath: '/',
          metadataRoutes: {
            sitemap: { load: async () => ({}), filePath: 'app/(marketing)/sitemap.ts' },
          },
        }),
      ],
    });

    const match = createMetadataRouteMatcher(makeManifest(root));
    const result = match('/sitemap.xml');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('sitemap');
  });
});
