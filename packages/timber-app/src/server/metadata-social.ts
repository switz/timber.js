/**
 * Social metadata rendering — Open Graph and Twitter Card meta tags.
 *
 * Extracted from metadata-render.ts to keep files under 500 lines.
 *
 * See design/16-metadata.md
 */

import type { Metadata } from './types.js';
import type { HeadElement } from './metadata.js';

/**
 * Render Open Graph metadata into head element descriptors.
 *
 * Handles og:title, og:description, og:image (with dimensions/alt),
 * og:video, og:audio, og:article:author, and other OG properties.
 */
export function renderOpenGraph(
  og: NonNullable<Metadata['openGraph']>,
  elements: HeadElement[]
): void {
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

  // Images — normalize single object to array for uniform handling
  if (og.images) {
    if (typeof og.images === 'string') {
      elements.push({ tag: 'meta', attrs: { property: 'og:image', content: og.images } });
    } else {
      const imgList = Array.isArray(og.images) ? og.images : [og.images];
      for (const img of imgList) {
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

/**
 * Render Twitter Card metadata into head element descriptors.
 *
 * Handles twitter:card, twitter:site, twitter:title, twitter:image,
 * twitter:player, and twitter:app (per-platform name/id/url).
 */
export function renderTwitter(tw: NonNullable<Metadata['twitter']>, elements: HeadElement[]): void {
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

  // Images — normalize single object to array for uniform handling
  if (tw.images) {
    if (typeof tw.images === 'string') {
      elements.push({ tag: 'meta', attrs: { name: 'twitter:image', content: tw.images } });
    } else {
      const imgList = Array.isArray(tw.images) ? tw.images : [tw.images];
      for (const img of imgList) {
        const url = typeof img === 'string' ? img : img.url;
        elements.push({ tag: 'meta', attrs: { name: 'twitter:image', content: url } });
      }
    }
  }

  // Player card fields
  if (tw.players) {
    for (const player of tw.players) {
      elements.push({ tag: 'meta', attrs: { name: 'twitter:player', content: player.playerUrl } });
      if (player.width) {
        elements.push({
          tag: 'meta',
          attrs: { name: 'twitter:player:width', content: String(player.width) },
        });
      }
      if (player.height) {
        elements.push({
          tag: 'meta',
          attrs: { name: 'twitter:player:height', content: String(player.height) },
        });
      }
      if (player.streamUrl) {
        elements.push({
          tag: 'meta',
          attrs: { name: 'twitter:player:stream', content: player.streamUrl },
        });
      }
    }
  }

  // App card fields — 3 platforms × 3 attributes (name, id, url)
  if (tw.app) {
    const platforms: Array<[keyof NonNullable<typeof tw.app.id>, string]> = [
      ['iPhone', 'iphone'],
      ['iPad', 'ipad'],
      ['googlePlay', 'googleplay'],
    ];

    // App name is shared across platforms but the spec uses per-platform names.
    // Emit for each platform that has an ID.
    if (tw.app.name) {
      for (const [key, tag] of platforms) {
        if (tw.app.id?.[key]) {
          elements.push({
            tag: 'meta',
            attrs: { name: `twitter:app:name:${tag}`, content: tw.app.name },
          });
        }
      }
    }

    for (const [key, tag] of platforms) {
      const id = tw.app.id?.[key];
      if (id) {
        elements.push({ tag: 'meta', attrs: { name: `twitter:app:id:${tag}`, content: id } });
      }
    }

    for (const [key, tag] of platforms) {
      const url = tw.app.url?.[key];
      if (url) {
        elements.push({ tag: 'meta', attrs: { name: `twitter:app:url:${tag}`, content: url } });
      }
    }
  }
}
