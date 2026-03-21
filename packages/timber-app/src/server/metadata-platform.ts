/**
 * Platform-specific metadata rendering — icons, Apple Web App, App Links, iTunes.
 *
 * Extracted from metadata-render.ts to keep files under 500 lines.
 *
 * See design/16-metadata.md
 */

import type { Metadata } from './types.js';
import type { HeadElement } from './metadata.js';

/**
 * Render icon link elements (favicon, shortcut, apple-touch-icon, custom).
 */
export function renderIcons(icons: NonNullable<Metadata['icons']>, elements: HeadElement[]): void {
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

/**
 * Render alternate link elements (canonical, hreflang, media, types).
 */
export function renderAlternates(
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

/**
 * Render site verification meta tags (Google, Yahoo, Yandex, custom).
 */
export function renderVerification(
  verification: NonNullable<Metadata['verification']>,
  elements: HeadElement[]
): void {
  const verificationProps: Array<[string, string | undefined]> = [
    ['google-site-verification', verification.google],
    ['y_key', verification.yahoo],
    ['yandex-verification', verification.yandex],
  ];

  for (const [name, content] of verificationProps) {
    if (content) {
      elements.push({ tag: 'meta', attrs: { name, content } });
    }
  }
  if (verification.other) {
    for (const [name, value] of Object.entries(verification.other)) {
      const content = Array.isArray(value) ? value.join(', ') : value;
      elements.push({ tag: 'meta', attrs: { name, content } });
    }
  }
}

/**
 * Render Apple Web App meta tags and startup image links.
 */
export function renderAppleWebApp(
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

/**
 * Render App Links (al:*) meta tags for deep linking across platforms.
 */
export function renderAppLinks(
  appLinks: NonNullable<Metadata['appLinks']>,
  elements: HeadElement[]
): void {
  const platformEntries: Array<[string, Array<Record<string, unknown>> | undefined]> = [
    ['ios', appLinks.ios],
    ['android', appLinks.android],
    ['windows', appLinks.windows],
    ['windows_phone', appLinks.windowsPhone],
    ['windows_universal', appLinks.windowsUniversal],
  ];

  for (const [platform, entries] of platformEntries) {
    if (!entries) continue;
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

/**
 * Render Apple iTunes smart banner meta tag.
 */
export function renderItunes(
  itunes: NonNullable<Metadata['itunes']>,
  elements: HeadElement[]
): void {
  const parts = [`app-id=${itunes.appId}`];
  if (itunes.affiliateData) parts.push(`affiliate-data=${itunes.affiliateData}`);
  if (itunes.appArgument) parts.push(`app-argument=${itunes.appArgument}`);
  elements.push({
    tag: 'meta',
    attrs: { name: 'apple-itunes-app', content: parts.join(', ') },
  });
}
