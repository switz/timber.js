/**
 * Metadata resolution for timber.js.
 *
 * Resolves metadata from a segment chain (layouts + page), applies title
 * templates, shallow-merges entries, and produces head element descriptors.
 *
 * Resolution happens inside the render pass — React.cache is active,
 * metadata is outside Suspense, and the flush point guarantees completeness.
 *
 * Rendering (Metadata → HeadElement[]) is in metadata-render.ts.
 *
 * See design/16-metadata.md
 */

import type { Metadata } from './types.js';

// Re-export renderMetadataToElements from the rendering module so existing
// consumers (route-element-builder, tests) can keep importing from here.
export { renderMetadataToElements } from './metadata-render.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single metadata entry from a layout or page module. */
export interface SegmentMetadataEntry {
  /** The resolved metadata object (from static export or generateMetadata). */
  metadata: Metadata;
  /** Whether this entry is from the page (leaf) module. */
  isPage: boolean;
}

/** Options for resolveMetadata. */
export interface ResolveMetadataOptions {
  /**
   * When true, the page's metadata is discarded (simulating a render error)
   * and `<meta name="robots" content="noindex">` is injected.
   */
  errorState?: boolean;
}

/** A rendered head element descriptor. */
export interface HeadElement {
  tag: 'title' | 'meta' | 'link';
  content?: string;
  attrs?: Record<string, string>;
}

// ─── Title Resolution ────────────────────────────────────────────────────────

/**
 * Resolve a title value with an optional template.
 *
 * - string → apply template if present
 * - { absolute: '...' } → use as-is, skip template
 * - { default: '...' } → use as fallback (no template applied)
 * - undefined → undefined
 */
export function resolveTitle(
  title: Metadata['title'],
  template: string | undefined
): string | undefined {
  if (title === undefined || title === null) {
    return undefined;
  }

  if (typeof title === 'string') {
    return template ? template.replace('%s', title) : title;
  }

  // Object form
  if (title.absolute !== undefined) {
    return title.absolute;
  }

  if (title.default !== undefined) {
    return title.default;
  }

  return undefined;
}

// ─── Metadata Resolution ─────────────────────────────────────────────────────

/**
 * Resolve metadata from a segment chain.
 *
 * Processes entries from root layout to page (in segment order).
 * The merge algorithm:
 *   1. Shallow-merge all keys except title (later wins)
 *   2. Track the most recent title template
 *   3. Resolve the final title using the template
 *
 * In error state, the page entry is dropped and noindex is injected.
 *
 * See design/16-metadata.md §"Merge Algorithm"
 */
export function resolveMetadata(
  entries: SegmentMetadataEntry[],
  options: ResolveMetadataOptions = {}
): Metadata {
  const { errorState = false } = options;

  const merged: Metadata = {};
  let titleTemplate: string | undefined;
  let lastDefault: string | undefined;
  let rawTitle: Metadata['title'];

  for (const { metadata, isPage } of entries) {
    // In error state, skip the page's metadata entirely
    if (errorState && isPage) {
      continue;
    }

    // Track title template
    if (metadata.title !== undefined && typeof metadata.title === 'object') {
      if (metadata.title.template !== undefined) {
        titleTemplate = metadata.title.template;
      }
      if (metadata.title.default !== undefined) {
        lastDefault = metadata.title.default;
      }
    }

    // Shallow-merge all keys except title
    for (const key of Object.keys(metadata) as Array<keyof Metadata>) {
      if (key === 'title') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[key] = metadata[key];
    }

    // Track raw title (will be resolved after the loop)
    if (metadata.title !== undefined) {
      rawTitle = metadata.title;
    }
  }

  // In error state, we lost page title — use the most recent default
  if (errorState) {
    rawTitle = lastDefault !== undefined ? { default: lastDefault } : rawTitle;
    // Don't apply template in error state
    titleTemplate = undefined;
  }

  // Resolve the final title
  const resolvedTitle = resolveTitle(rawTitle, titleTemplate);
  if (resolvedTitle !== undefined) {
    merged.title = resolvedTitle;
  }

  // Error state: inject noindex, overriding any user robots
  if (errorState) {
    merged.robots = 'noindex';
  }

  return merged;
}

// ─── URL Resolution ──────────────────────────────────────────────────────────

/**
 * Check if a string is an absolute URL.
 */
function isAbsoluteUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//');
}

/**
 * Resolve a relative URL against a base URL.
 */
function resolveUrl(url: string, base: URL): string {
  if (isAbsoluteUrl(url)) return url;
  return new URL(url, base).toString();
}

/**
 * Resolve relative URLs in metadata fields against metadataBase.
 *
 * Returns a new metadata object with URLs resolved. Absolute URLs are not modified.
 * If metadataBase is not set, returns the metadata unchanged.
 */
export function resolveMetadataUrls(metadata: Metadata): Metadata {
  const base = metadata.metadataBase;
  if (!base) return metadata;

  const result = { ...metadata };

  // Resolve openGraph images
  if (result.openGraph) {
    result.openGraph = { ...result.openGraph };
    if (typeof result.openGraph.images === 'string') {
      result.openGraph.images = resolveUrl(result.openGraph.images, base);
    } else if (Array.isArray(result.openGraph.images)) {
      result.openGraph.images = result.openGraph.images.map((img) => {
        if (typeof img === 'string') {
          return { url: resolveUrl(img, base) };
        }
        return { ...img, url: resolveUrl(img.url, base) };
      });
    }
    if (result.openGraph.url && !isAbsoluteUrl(result.openGraph.url)) {
      result.openGraph.url = resolveUrl(result.openGraph.url, base);
    }
  }

  // Resolve twitter images
  if (result.twitter) {
    result.twitter = { ...result.twitter };
    if (typeof result.twitter.images === 'string') {
      result.twitter.images = resolveUrl(result.twitter.images, base);
    } else if (Array.isArray(result.twitter.images)) {
      // Resolve each image URL, preserving the union type structure
      const resolved = result.twitter.images.map((img) =>
        typeof img === 'string' ? resolveUrl(img, base) : { ...img, url: resolveUrl(img.url, base) }
      );
      // If all entries are strings, assign as string[]; otherwise as object[]
      const allStrings = resolved.every((r) => typeof r === 'string');
      result.twitter.images = allStrings
        ? (resolved as string[])
        : (resolved as Array<{ url: string; alt?: string; width?: number; height?: number }>);
    }
  }

  // Resolve alternates
  if (result.alternates) {
    result.alternates = { ...result.alternates };
    if (result.alternates.canonical && !isAbsoluteUrl(result.alternates.canonical)) {
      result.alternates.canonical = resolveUrl(result.alternates.canonical, base);
    }
    if (result.alternates.languages) {
      const langs: Record<string, string> = {};
      for (const [lang, url] of Object.entries(result.alternates.languages)) {
        langs[lang] = isAbsoluteUrl(url) ? url : resolveUrl(url, base);
      }
      result.alternates.languages = langs;
    }
  }

  // Resolve icon URLs
  if (result.icons) {
    result.icons = { ...result.icons };
    if (typeof result.icons.icon === 'string') {
      result.icons.icon = resolveUrl(result.icons.icon, base);
    } else if (Array.isArray(result.icons.icon)) {
      result.icons.icon = result.icons.icon.map((i) => ({ ...i, url: resolveUrl(i.url, base) }));
    }
    if (typeof result.icons.apple === 'string') {
      result.icons.apple = resolveUrl(result.icons.apple, base);
    } else if (Array.isArray(result.icons.apple)) {
      result.icons.apple = result.icons.apple.map((i) => ({ ...i, url: resolveUrl(i.url, base) }));
    }
  }

  return result;
}

