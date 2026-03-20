/**
 * Metadata rendering — converts resolved Metadata into HeadElement descriptors.
 *
 * Extracted from metadata.ts to keep files under 500 lines.
 *
 * See design/16-metadata.md
 */

import type { Metadata } from './types.js';
import type { HeadElement } from './metadata.js';
import { renderOpenGraph, renderTwitter } from './metadata-social.js';
import {
  renderIcons,
  renderAlternates,
  renderVerification,
  renderAppleWebApp,
  renderAppLinks,
  renderItunes,
} from './metadata-platform.js';

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

  // Simple string meta tags
  const simpleMetaProps: Array<[string, string | undefined]> = [
    ['description', metadata.description],
    ['generator', metadata.generator],
    ['application-name', metadata.applicationName],
    ['referrer', metadata.referrer],
    ['category', metadata.category],
    ['creator', metadata.creator],
    ['publisher', metadata.publisher],
  ];

  for (const [name, content] of simpleMetaProps) {
    if (content) {
      elements.push({ tag: 'meta', attrs: { name, content } });
    }
  }

  // Keywords (array or string)
  if (metadata.keywords) {
    const content = Array.isArray(metadata.keywords)
      ? metadata.keywords.join(', ')
      : metadata.keywords;
    elements.push({ tag: 'meta', attrs: { name: 'keywords', content } });
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

  // Authors
  if (metadata.authors) {
    const authorList = Array.isArray(metadata.authors) ? metadata.authors : [metadata.authors];
    for (const author of authorList) {
      if (author.name) {
        elements.push({ tag: 'meta', attrs: { name: 'author', content: author.name } });
      }
      if (author.url) {
        elements.push({ tag: 'link', attrs: { rel: 'author', href: author.url } });
      }
    }
  }

  // Apple Web App
  if (metadata.appleWebApp) {
    renderAppleWebApp(metadata.appleWebApp, elements);
  }

  // App Links (al:*)
  if (metadata.appLinks) {
    renderAppLinks(metadata.appLinks, elements);
  }

  // iTunes
  if (metadata.itunes) {
    renderItunes(metadata.itunes, elements);
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
