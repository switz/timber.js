/**
 * Metadata rendering — converts resolved Metadata into HeadElement descriptors.
 *
 * Extracted from metadata.ts to keep files under 500 lines.
 *
 * See design/16-metadata.md
 */

import type { Metadata } from './types.js';
import type { HeadElement } from './metadata.js';

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

function renderAppleWebApp(
  appleWebApp: NonNullable<Metadata['appleWebApp']>,
  elements: HeadElement[]
): void {
  if (appleWebApp.capable) {
    elements.push({
      tag: 'meta',
      attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' },
    });
  }
  if (appleWebApp.title) {
    elements.push({
      tag: 'meta',
      attrs: { name: 'apple-mobile-web-app-title', content: appleWebApp.title },
    });
  }
  if (appleWebApp.statusBarStyle) {
    elements.push({
      tag: 'meta',
      attrs: {
        name: 'apple-mobile-web-app-status-bar-style',
        content: appleWebApp.statusBarStyle,
      },
    });
  }
  if (appleWebApp.startupImage) {
    const images = Array.isArray(appleWebApp.startupImage)
      ? appleWebApp.startupImage
      : [{ url: appleWebApp.startupImage }];
    for (const img of images) {
      const url = typeof img === 'string' ? img : img.url;
      const attrs: Record<string, string> = { rel: 'apple-touch-startup-image', href: url };
      if (typeof img === 'object' && img.media) {
        attrs.media = img.media;
      }
      elements.push({ tag: 'link', attrs });
    }
  }
}

function renderAppLinks(
  appLinks: NonNullable<Metadata['appLinks']>,
  elements: HeadElement[]
): void {
  // Helper: emit al:platform:property tags for an array of platform entries
  function emitPlatform(platform: string, entries: Array<Record<string, unknown>> | undefined) {
    if (!entries) return;
    for (const entry of entries) {
      for (const [key, value] of Object.entries(entry)) {
        if (value !== undefined && value !== null) {
          elements.push({
            tag: 'meta',
            attrs: { property: `al:${platform}:${key}`, content: String(value) },
          });
        }
      }
    }
  }

  emitPlatform('ios', appLinks.ios);
  emitPlatform('android', appLinks.android);
  emitPlatform('windows', appLinks.windows);
  emitPlatform('windows_phone', appLinks.windowsPhone);
  emitPlatform('windows_universal', appLinks.windowsUniversal);

  if (appLinks.web) {
    if (appLinks.web.url) {
      elements.push({
        tag: 'meta',
        attrs: { property: 'al:web:url', content: appLinks.web.url },
      });
    }
    if (appLinks.web.shouldFallback !== undefined) {
      elements.push({
        tag: 'meta',
        attrs: {
          property: 'al:web:should_fallback',
          content: appLinks.web.shouldFallback ? 'true' : 'false',
        },
      });
    }
  }
}

function renderItunes(itunes: NonNullable<Metadata['itunes']>, elements: HeadElement[]): void {
  const parts = [`app-id=${itunes.appId}`];
  if (itunes.affiliateData) parts.push(`affiliate-data=${itunes.affiliateData}`);
  if (itunes.appArgument) parts.push(`app-argument=${itunes.appArgument}`);
  elements.push({
    tag: 'meta',
    attrs: { name: 'apple-itunes-app', content: parts.join(', ') },
  });
}
