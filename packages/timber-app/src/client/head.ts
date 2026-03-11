// Client-side head element updates for SPA navigation.
//
// On RSC payload responses, the server sends resolved HeadElement[] via the
// X-Timber-Head response header. This module applies those elements to the
// DOM so document.title and <meta> tags stay current after navigation.
//
// See design/16-metadata.md

// ─── Types ───────────────────────────────────────────────────────

/** Marker attribute for timber-managed head elements (cleanup on next navigation). */
const TIMBER_ATTR = 'data-timber-head';

/** A rendered head element descriptor (matches server-side HeadElement from metadata.ts). */
export interface HeadElement {
  tag: 'title' | 'meta' | 'link';
  content?: string;
  attrs?: Record<string, string>;
}

// ─── Apply Head Elements ─────────────────────────────────────────

/**
 * Apply resolved head elements to the DOM.
 *
 * - Sets document.title for <title> elements
 * - Creates <meta> and <link> tags with a data-timber-head marker
 * - Removes previous timber-managed tags to prevent accumulation
 * - Replaces existing SSR-rendered tags with the same name/property
 */
export function applyHeadElements(elements: HeadElement[]): void {
  // Remove previous timber-managed meta/link tags
  document.head.querySelectorAll(`[${TIMBER_ATTR}]`).forEach((el) => el.remove());

  for (const el of elements) {
    if (el.tag === 'title' && el.content !== undefined) {
      document.title = el.content;
      continue;
    }

    if (!el.attrs) continue;

    // For meta: remove existing tag with same name/property to avoid duplicates from SSR
    if (el.tag === 'meta') {
      const key = el.attrs.name || el.attrs.property;
      if (key) {
        const existing = document.head.querySelector(
          `meta[name="${key}"], meta[property="${key}"]`
        );
        if (existing) existing.remove();
      }
    }

    const node = document.createElement(el.tag);
    node.setAttribute(TIMBER_ATTR, '');
    for (const [k, v] of Object.entries(el.attrs)) {
      node.setAttribute(k, v);
    }
    document.head.appendChild(node);
  }
}
