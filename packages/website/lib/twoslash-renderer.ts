/**
 * Custom twoslash renderer that uses CSS Anchor Positioning API
 * for tooltip placement instead of JavaScript-based positioning.
 *
 * Falls back to absolute positioning in browsers without anchor support.
 */

import type { TwoslashRenderer } from '@shikijs/twoslash';
import type { Element, ElementContent } from 'hast';

/**
 * Creates a twoslash renderer that positions type tooltips using CSS Anchor API.
 *
 * Each hover token gets a unique `anchor-name` via inline style. The tooltip
 * sibling uses `position-anchor` to attach to it. Show/hide is pure CSS `:hover`.
 *
 * Progressive enhancement via `@supports(anchor-name: --x)` in the stylesheet —
 * unsupported browsers fall back to `position: absolute` relative to the token.
 */
export function rendererCssAnchor(): TwoslashRenderer {
  let counter = 0;

  return {
    nodeStaticInfo(info, node) {
      const id = `ts-${counter++}`;
      const anchorName = `--${id}`;

      const typeText = processHoverInfo(info.text);
      if (!typeText) return node as Partial<ElementContent>;

      const popupChildren: ElementContent[] = [
        {
          type: 'element',
          tagName: 'code',
          properties: { class: 'twoslash-popup-code' },
          children: [{ type: 'text', value: typeText }],
        },
      ];

      // Include JSDoc if present
      if (info.docs) {
        popupChildren.push({
          type: 'element',
          tagName: 'div',
          properties: { class: 'twoslash-popup-docs' },
          children: [{ type: 'text', value: info.docs }],
        });
      }

      const popup: Element = {
        type: 'element',
        tagName: 'span',
        properties: {
          class: 'twoslash-popup',
          style: `position-anchor: ${anchorName}`,
        },
        children: popupChildren,
      };

      return {
        type: 'element',
        tagName: 'span',
        properties: {
          class: 'twoslash-hover',
          style: `anchor-name: ${anchorName}`,
        },
        children: [node as ElementContent, popup],
      };
    },

    nodeError(error, node) {
      return {
        type: 'element',
        tagName: 'span',
        properties: {
          class: 'twoslash-error',
          title: error.text,
        },
        children: [node as ElementContent],
      };
    },

    nodeQuery(query, node) {
      const id = `ts-q-${counter++}`;
      const anchorName = `--${id}`;

      const typeText = processHoverInfo(query.text);
      if (!typeText) return node as Partial<ElementContent>;

      const popup: Element = {
        type: 'element',
        tagName: 'span',
        properties: {
          class: 'twoslash-popup twoslash-popup-query',
          style: `position-anchor: ${anchorName}`,
        },
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { class: 'twoslash-popup-code' },
            children: [{ type: 'text', value: typeText }],
          },
        ],
      };

      return {
        type: 'element',
        tagName: 'span',
        properties: {
          class: 'twoslash-hover twoslash-query-target',
          style: `anchor-name: ${anchorName}`,
        },
        children: [node as ElementContent, popup],
      };
    },
  };
}

/**
 * Process hover info text: remove leading keywords like `const`, `let`, `function`
 * prefix and clean up for display.
 */
function processHoverInfo(text: string): string {
  // Clean up the type text — remove the "(property)" etc prefixes that
  // TS produces but keep the signature
  let cleaned = text.replace(/^\(alias\)\s+/gm, '').replace(/^import\s+/gm, '');

  // Trim excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
