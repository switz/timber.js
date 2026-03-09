/**
 * Metadata route classification for timber.js.
 *
 * Metadata routes are file-based endpoints that generate well-known URLs for
 * crawlers and browsers (sitemap.xml, robots.txt, OG images, etc.).
 *
 * These routes run through proxy.ts but NOT through middleware.ts or access.ts —
 * they are public endpoints by nature.
 *
 * See design/16-metadata.md §"Metadata Routes"
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Classification of a metadata route file. */
export interface MetadataRouteInfo {
  /** The metadata route type. */
  type: MetadataRouteType;
  /** The content type to serve this route with. */
  contentType: string;
  /** Whether this route can appear in nested segments (not just app root). */
  nestable: boolean;
}

export type MetadataRouteType =
  | 'sitemap'
  | 'robots'
  | 'manifest'
  | 'favicon'
  | 'icon'
  | 'opengraph-image'
  | 'twitter-image'
  | 'apple-icon';

// ─── Convention Table ────────────────────────────────────────────────────────

/**
 * All recognized metadata route file conventions.
 *
 * Each entry maps a base file name (without extension) to its route info.
 * The extensions determine whether the file is static or dynamic.
 *
 * Static extensions: .xml, .txt, .json, .png, .jpg, .ico, .svg
 * Dynamic extensions: .ts, .tsx
 */
export const METADATA_ROUTE_CONVENTIONS: Record<
  string,
  {
    type: MetadataRouteType;
    contentType: string;
    nestable: boolean;
    staticExtensions: string[];
    dynamicExtensions: string[];
    /** The URL path this file serves at (relative to segment). */
    servePath: string;
  }
> = {
  'sitemap': {
    type: 'sitemap',
    contentType: 'application/xml',
    nestable: true,
    staticExtensions: ['xml'],
    dynamicExtensions: ['ts'],
    servePath: 'sitemap.xml',
  },
  'robots': {
    type: 'robots',
    contentType: 'text/plain',
    nestable: false,
    staticExtensions: ['txt'],
    dynamicExtensions: ['ts'],
    servePath: 'robots.txt',
  },
  'manifest': {
    type: 'manifest',
    contentType: 'application/manifest+json',
    nestable: false,
    staticExtensions: ['json'],
    dynamicExtensions: ['ts'],
    servePath: 'manifest.webmanifest',
  },
  'favicon': {
    type: 'favicon',
    contentType: 'image/x-icon',
    nestable: false,
    staticExtensions: ['ico'],
    dynamicExtensions: [],
    servePath: 'favicon.ico',
  },
  'icon': {
    type: 'icon',
    contentType: 'image/*',
    nestable: true,
    staticExtensions: ['png', 'jpg', 'svg'],
    dynamicExtensions: ['ts', 'tsx'],
    servePath: 'icon',
  },
  'opengraph-image': {
    type: 'opengraph-image',
    contentType: 'image/*',
    nestable: true,
    staticExtensions: ['png', 'jpg'],
    dynamicExtensions: ['ts', 'tsx'],
    servePath: 'opengraph-image',
  },
  'twitter-image': {
    type: 'twitter-image',
    contentType: 'image/*',
    nestable: true,
    staticExtensions: ['png', 'jpg'],
    dynamicExtensions: ['ts', 'tsx'],
    servePath: 'twitter-image',
  },
  'apple-icon': {
    type: 'apple-icon',
    contentType: 'image/*',
    nestable: true,
    staticExtensions: ['png'],
    dynamicExtensions: ['ts', 'tsx'],
    servePath: 'apple-icon',
  },
};

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Classify a file name as a metadata route, or return null if it's not one.
 *
 * @param fileName - The full file name including extension (e.g. "sitemap.xml", "icon.tsx")
 * @returns Classification info, or null if not a metadata route
 */
export function classifyMetadataRoute(fileName: string): MetadataRouteInfo | null {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const baseName = fileName.slice(0, dotIndex);
  const ext = fileName.slice(dotIndex + 1);

  const convention = METADATA_ROUTE_CONVENTIONS[baseName];
  if (!convention) return null;

  const isStatic = convention.staticExtensions.includes(ext);
  const isDynamic = convention.dynamicExtensions.includes(ext);

  if (!isStatic && !isDynamic) return null;

  return {
    type: convention.type,
    contentType: convention.contentType,
    nestable: convention.nestable,
  };
}

/**
 * Get the serve path for a metadata route type.
 *
 * @param type - The metadata route type
 * @returns The URL path fragment this route serves at
 */
export function getMetadataRouteServePath(type: MetadataRouteType): string {
  for (const convention of Object.values(METADATA_ROUTE_CONVENTIONS)) {
    if (convention.type === type) return convention.servePath;
  }
  throw new Error(`[timber] Unknown metadata route type: ${type}`);
}

/**
 * Get the auto-link tags to inject into <head> for metadata route files
 * discovered in a segment.
 *
 * @param type - The metadata route type
 * @param href - The resolved URL path to the metadata route
 * @returns An object with tag/attrs for the <head>, or null if no auto-link
 */
export function getMetadataRouteAutoLink(
  type: MetadataRouteType,
  href: string
): { rel: string; href: string; type?: string } | null {
  switch (type) {
    case 'icon':
      return { rel: 'icon', href };
    case 'apple-icon':
      return { rel: 'apple-touch-icon', href };
    case 'manifest':
      return { rel: 'manifest', href };
    default:
      return null;
  }
}
