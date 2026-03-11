/**
 * Parallel slot resolution for RSC rendering.
 *
 * Resolves slot elements for a layout's parallel routes (@slot directories).
 * Each slot either matches the current URL (renders its page) or doesn't
 * match (renders default.tsx fallback).
 *
 * Slots are rendered within the single renderToReadableStream call as
 * named props to their parent layout — no separate render passes.
 *
 * See design/02-rendering-pipeline.md §"Parallel Slots"
 */

import type { ManifestSegmentNode } from './route-matcher.js';
import type { RouteMatch } from './pipeline.js';
import { SlotAccessGate } from './access-gate.js';

type CreateElementFn = (...args: unknown[]) => React.ReactElement;

/**
 * Resolve the element for a parallel slot.
 *
 * Finds a matching page in the slot's sub-tree for the current route.
 * Falls back to default.tsx if no match, or null if no default.
 */
export async function resolveSlotElement(
  slotNode: ManifestSegmentNode,
  match: RouteMatch,
  paramsPromise: Promise<Record<string, string>>,
  h: CreateElementFn
): Promise<React.ReactElement | null> {
  const matchedPage = findSlotPage(slotNode, match);

  if (matchedPage) {
    const mod = (await matchedPage.load()) as Record<string, unknown>;
    if (mod.default) {
      const SlotPage = mod.default as (...args: unknown[]) => unknown;
      let element: React.ReactElement = h(SlotPage, {
        params: paramsPromise,
        searchParams: {},
      });

      // Wrap in SlotAccessGate if slot has access.ts.
      // On denial: denied.tsx → default.tsx → null (graceful degradation).
      // See design/04-authorization.md §"Slot-Level Auth".
      if (slotNode.access) {
        const accessMod = (await slotNode.access.load()) as Record<string, unknown>;
        const accessFn = accessMod.default as
          | ((ctx: { params: Record<string, string>; searchParams: unknown }) => unknown)
          | undefined;
        if (accessFn) {
          // Load denied.tsx fallback
          let deniedFallback: React.ReactElement | null = null;
          if (slotNode.denied) {
            const deniedMod = (await slotNode.denied.load()) as Record<string, unknown>;
            const DeniedComponent = deniedMod.default as
              | ((...args: unknown[]) => unknown)
              | undefined;
            if (DeniedComponent) {
              deniedFallback = h(DeniedComponent, {});
            }
          }

          // Load default.tsx fallback
          let defaultFallback: React.ReactElement | null = null;
          if (slotNode.default) {
            const defaultMod = (await slotNode.default.load()) as Record<string, unknown>;
            const DefaultComp = defaultMod.default as ((...args: unknown[]) => unknown) | undefined;
            if (DefaultComp) {
              defaultFallback = h(DefaultComp, { params: paramsPromise, searchParams: {} });
            }
          }

          const params = await paramsPromise;
          element = h(SlotAccessGate, {
            accessFn,
            params,
            searchParams: {},
            deniedFallback,
            defaultFallback,
            children: element,
          });
        }
      }

      return element;
    }
  }

  // No matching page — render default.tsx fallback
  if (slotNode.default) {
    const mod = (await slotNode.default.load()) as Record<string, unknown>;
    if (mod.default) {
      const DefaultComponent = mod.default as (...args: unknown[]) => unknown;
      return h(DefaultComponent, { params: paramsPromise, searchParams: {} });
    }
  }

  // No page and no default — slot renders nothing
  return null;
}

/**
 * Find a matching page in a slot's sub-tree for the current route.
 *
 * Slots don't add URL depth (they're at the same level as their parent).
 * A slot at segment /parallel with children /parallel/projects means:
 *   - URL /parallel → slot's own page.tsx
 *   - URL /parallel/projects → slot's projects/page.tsx
 *   - URL /parallel/about → no match (use default.tsx)
 *
 * We compare the matched route's segment chain against the slot's children
 * to find the deepest matching page.
 */
function findSlotPage(
  slotNode: ManifestSegmentNode,
  match: RouteMatch
): ManifestSegmentNode['page'] | null {
  const segments = match.segments as unknown as ManifestSegmentNode[];

  // Find the parent segment that owns this slot by comparing urlPaths.
  // The slot's urlPath matches its parent's urlPath (slots don't add URL depth).
  const slotUrlPath = slotNode.urlPath;
  let parentIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].urlPath === slotUrlPath) {
      parentIndex = i;
      break;
    }
  }

  // The remaining segments after the parent are what we need to match
  // against the slot's children.
  const remainingSegments = parentIndex >= 0 ? segments.slice(parentIndex + 1) : [];

  // If no remaining segments, the slot's own page matches
  if (remainingSegments.length === 0) {
    return slotNode.page ?? null;
  }

  // Walk the slot's children to match remaining URL segments
  let currentNode = slotNode;
  for (const seg of remainingSegments) {
    const childName = seg.segmentName;
    const directChildren = currentNode.children ?? [];

    let found: ManifestSegmentNode | null = null;
    for (const child of directChildren) {
      // Exact static match
      if (child.segmentType === 'static' && child.segmentName === childName) {
        found = child;
        break;
      }
    }

    // Try dynamic segments if no static match
    if (!found) {
      for (const child of directChildren) {
        if (child.segmentType === 'dynamic' || child.segmentType === 'catch-all') {
          found = child;
          break;
        }
      }
    }

    // Try group children (transparent)
    if (!found) {
      for (const child of directChildren) {
        if (child.segmentType === 'group') {
          for (const groupChild of child.children ?? []) {
            if (groupChild.segmentName === childName) {
              found = groupChild;
              break;
            }
          }
          if (found) break;
        }
      }
    }

    if (!found) {
      // No matching child in slot tree — slot doesn't match this URL
      return null;
    }
    currentNode = found;
  }

  return currentNode.page ?? null;
}
