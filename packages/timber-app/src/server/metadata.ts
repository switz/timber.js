/**
 * Metadata resolution and rendering for timber.js.
 *
 * Resolves metadata from a segment chain (layouts + page), applies title
 * templates, shallow-merges entries, and produces head element descriptors.
 *
 * Resolution happens inside the render pass — React.cache is active,
 * metadata is outside Suspense, and the flush point guarantees completeness.
 *
 * See design/16-metadata.md
 */

import type { Metadata } from './types.js';

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

// ─── Render to Elements ──────────────────────────────────────────────────────

/**
 * Convert resolved metadata into an array of head element descriptors.
 *
 * Each descriptor has a `tag` ('title', 'meta', 'link') and either
 * `content` (for <title>) or `attrs` (for <meta>/<link>).
 *
 * The framework's MetadataResolver component consumes these descriptors
 * and renders them into the <head>.
 */
export function renderMetadataToElements(metadata: Metadata): HeadElement[] {
  const elements: HeadElement[] = [];

  // Title
  if (typeof metadata.title === 'string') {
    elements.push({ tag: 'title', content: metadata.title });
  }

  // Description
  if (metadata.description) {
    elements.push({ tag: 'meta', attrs: { name: 'description', content: metadata.description } });
  }

  // Generator
  if (metadata.generator) {
    elements.push({ tag: 'meta', attrs: { name: 'generator', content: metadata.generator } });
  }

  // Application name
  if (metadata.applicationName) {
    elements.push({
      tag: 'meta',
      attrs: { name: 'application-name', content: metadata.applicationName },
    });
  }

  // Referrer
  if (metadata.referrer) {
    elements.push({ tag: 'meta', attrs: { name: 'referrer', content: metadata.referrer } });
  }

  // Keywords
  if (metadata.keywords) {
    const content = Array.isArray(metadata.keywords)
      ? metadata.keywords.join(', ')
      : metadata.keywords;
    elements.push({ tag: 'meta', attrs: { name: 'keywords', content } });
  }

  // Category
  if (metadata.category) {
    elements.push({ tag: 'meta', attrs: { name: 'category', content: metadata.category } });
  }

  // Creator
  if (metadata.creator) {
    elements.push({ tag: 'meta', attrs: { name: 'creator', content: metadata.creator } });
  }

  // Publisher
  if (metadata.publisher) {
    elements.push({ tag: 'meta', attrs: { name: 'publisher', content: metadata.publisher } });
  }

  // Robots
  if (metadata.robots) {
    const content =
      typeof metadata.robots === 'string' ? metadata.robots : renderRobotsObject(metadata.robots);
    elements.push({ tag: 'meta', attrs: { name: 'robots', content } });

    // googleBot as separate tag
    if (typeof metadata.robots === 'object' && metadata.robots.googleBot) {
      const gbContent =
        typeof metadata.robots.googleBot === 'string'
          ? metadata.robots.googleBot
          : renderRobotsObject(metadata.robots.googleBot);
      elements.push({ tag: 'meta', attrs: { name: 'googlebot', content: gbContent } });
    }
  }

  // Open Graph
  if (metadata.openGraph) {
    renderOpenGraph(metadata.openGraph, elements);
  }

  // Twitter
  if (metadata.twitter) {
    renderTwitter(metadata.twitter, elements);
  }

  // Icons
  if (metadata.icons) {
    renderIcons(metadata.icons, elements);
  }

  // Manifest
  if (metadata.manifest) {
    elements.push({ tag: 'link', attrs: { rel: 'manifest', href: metadata.manifest } });
  }

  // Alternates
  if (metadata.alternates) {
    renderAlternates(metadata.alternates, elements);
  }

  // Verification
  if (metadata.verification) {
    renderVerification(metadata.verification, elements);
  }

  // Format detection
  if (metadata.formatDetection) {
    const parts: string[] = [];
    if (metadata.formatDetection.telephone === false) parts.push('telephone=no');
    if (metadata.formatDetection.email === false) parts.push('email=no');
    if (metadata.formatDetection.address === false) parts.push('address=no');
    if (parts.length > 0) {
      elements.push({
        tag: 'meta',
        attrs: { name: 'format-detection', content: parts.join(', ') },
      });
    }
  }

  // Other (custom meta tags)
  if (metadata.other) {
    for (const [name, value] of Object.entries(metadata.other)) {
      const content = Array.isArray(value) ? value.join(', ') : value;
      elements.push({ tag: 'meta', attrs: { name, content } });
    }
  }

  return elements;
}

// ─── Rendering Helpers ───────────────────────────────────────────────────────

function renderRobotsObject(robots: Record<string, unknown>): string {
  const parts: string[] = [];
  if (robots.index === true) parts.push('index');
  if (robots.index === false) parts.push('noindex');
  if (robots.follow === true) parts.push('follow');
  if (robots.follow === false) parts.push('nofollow');
  return parts.join(', ');
}

function renderOpenGraph(og: NonNullable<Metadata['openGraph']>, elements: HeadElement[]): void {
  const simpleProps: Array<[string, string | undefined]> = [
    ['og:title', og.title],
    ['og:description', og.description],
    ['og:url', og.url],
    ['og:site_name', og.siteName],
    ['og:locale', og.locale],
    ['og:type', og.type],
    ['og:article:published_time', og.publishedTime],
    ['og:article:modified_time', og.modifiedTime],
  ];

  for (const [property, content] of simpleProps) {
    if (content) {
      elements.push({ tag: 'meta', attrs: { property, content } });
    }
  }

  // Images
  if (og.images) {
    if (typeof og.images === 'string') {
      elements.push({ tag: 'meta', attrs: { property: 'og:image', content: og.images } });
    } else if (Array.isArray(og.images)) {
      for (const img of og.images) {
        elements.push({ tag: 'meta', attrs: { property: 'og:image', content: img.url } });
        if (img.width) {
          elements.push({
            tag: 'meta',
            attrs: { property: 'og:image:width', content: String(img.width) },
          });
        }
        if (img.height) {
          elements.push({
            tag: 'meta',
            attrs: { property: 'og:image:height', content: String(img.height) },
          });
        }
        if (img.alt) {
          elements.push({ tag: 'meta', attrs: { property: 'og:image:alt', content: img.alt } });
        }
      }
    }
  }

  // Videos
  if (og.videos) {
    for (const video of og.videos) {
      elements.push({ tag: 'meta', attrs: { property: 'og:video', content: video.url } });
    }
  }

  // Audio
  if (og.audio) {
    for (const audio of og.audio) {
      elements.push({ tag: 'meta', attrs: { property: 'og:audio', content: audio.url } });
    }
  }

  // Authors
  if (og.authors) {
    for (const author of og.authors) {
      elements.push({
        tag: 'meta',
        attrs: { property: 'og:article:author', content: author },
      });
    }
  }
}

function renderTwitter(tw: NonNullable<Metadata['twitter']>, elements: HeadElement[]): void {
  const simpleProps: Array<[string, string | undefined]> = [
    ['twitter:card', tw.card],
    ['twitter:site', tw.site],
    ['twitter:site:id', tw.siteId],
    ['twitter:title', tw.title],
    ['twitter:description', tw.description],
    ['twitter:creator', tw.creator],
    ['twitter:creator:id', tw.creatorId],
  ];

  for (const [name, content] of simpleProps) {
    if (content) {
      elements.push({ tag: 'meta', attrs: { name, content } });
    }
  }

  // Images
  if (tw.images) {
    if (typeof tw.images === 'string') {
      elements.push({ tag: 'meta', attrs: { name: 'twitter:image', content: tw.images } });
    } else if (Array.isArray(tw.images)) {
      for (const img of tw.images) {
        const url = typeof img === 'string' ? img : img.url;
        elements.push({ tag: 'meta', attrs: { name: 'twitter:image', content: url } });
      }
    }
  }
}

function renderIcons(icons: NonNullable<Metadata['icons']>, elements: HeadElement[]): void {
  // Icon
  if (icons.icon) {
    if (typeof icons.icon === 'string') {
      elements.push({ tag: 'link', attrs: { rel: 'icon', href: icons.icon } });
    } else if (Array.isArray(icons.icon)) {
      for (const icon of icons.icon) {
        const attrs: Record<string, string> = { rel: 'icon', href: icon.url };
        if (icon.sizes) attrs.sizes = icon.sizes;
        if (icon.type) attrs.type = icon.type;
        elements.push({ tag: 'link', attrs });
      }
    }
  }

  // Shortcut
  if (icons.shortcut) {
    const urls = Array.isArray(icons.shortcut) ? icons.shortcut : [icons.shortcut];
    for (const url of urls) {
      elements.push({ tag: 'link', attrs: { rel: 'shortcut icon', href: url } });
    }
  }

  // Apple
  if (icons.apple) {
    if (typeof icons.apple === 'string') {
      elements.push({ tag: 'link', attrs: { rel: 'apple-touch-icon', href: icons.apple } });
    } else if (Array.isArray(icons.apple)) {
      for (const icon of icons.apple) {
        const attrs: Record<string, string> = { rel: 'apple-touch-icon', href: icon.url };
        if (icon.sizes) attrs.sizes = icon.sizes;
        elements.push({ tag: 'link', attrs });
      }
    }
  }

  // Other
  if (icons.other) {
    for (const icon of icons.other) {
      const attrs: Record<string, string> = { rel: icon.rel, href: icon.url };
      if (icon.sizes) attrs.sizes = icon.sizes;
      if (icon.type) attrs.type = icon.type;
      elements.push({ tag: 'link', attrs });
    }
  }
}

function renderAlternates(
  alternates: NonNullable<Metadata['alternates']>,
  elements: HeadElement[]
): void {
  if (alternates.canonical) {
    elements.push({ tag: 'link', attrs: { rel: 'canonical', href: alternates.canonical } });
  }

  if (alternates.languages) {
    for (const [lang, href] of Object.entries(alternates.languages)) {
      elements.push({
        tag: 'link',
        attrs: { rel: 'alternate', hreflang: lang, href },
      });
    }
  }

  if (alternates.media) {
    for (const [media, href] of Object.entries(alternates.media)) {
      elements.push({
        tag: 'link',
        attrs: { rel: 'alternate', media, href },
      });
    }
  }

  if (alternates.types) {
    for (const [type, href] of Object.entries(alternates.types)) {
      elements.push({
        tag: 'link',
        attrs: { rel: 'alternate', type, href },
      });
    }
  }
}

function renderVerification(
  verification: NonNullable<Metadata['verification']>,
  elements: HeadElement[]
): void {
  if (verification.google) {
    elements.push({
      tag: 'meta',
      attrs: { name: 'google-site-verification', content: verification.google },
    });
  }
  if (verification.yahoo) {
    elements.push({
      tag: 'meta',
      attrs: { name: 'y_key', content: verification.yahoo },
    });
  }
  if (verification.yandex) {
    elements.push({
      tag: 'meta',
      attrs: { name: 'yandex-verification', content: verification.yandex },
    });
  }
  if (verification.other) {
    for (const [name, value] of Object.entries(verification.other)) {
      const content = Array.isArray(value) ? value.join(', ') : value;
      elements.push({ tag: 'meta', attrs: { name, content } });
    }
  }
}
