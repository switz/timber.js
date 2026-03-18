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
 * Each slot gets its own error boundaries (from error.tsx / status files
 * along the matched slot segment chain) and layouts (from layout.tsx files
 * in the slot's sub-tree). This enables independent error handling and
 * chrome per slot.
 *
 * See design/02-rendering-pipeline.md §"Parallel Slots"
 */

import type { ManifestSegmentNode } from './route-matcher.js';
import type { RouteMatch, InterceptionContext } from './pipeline.js';
import { SlotAccessGate } from './access-gate.js';
import { wrapSegmentWithErrorBoundaries } from './error-boundary-wrapper.js';
import { TimberErrorBoundary } from '#/client/error-boundary.js';
import SlotErrorFallback from '#/client/slot-error-fallback.js';

type CreateElementFn = (...args: unknown[]) => React.ReactElement;

/**
 * Resolve the element for a parallel slot.
 *
 * Finds a matching page in the slot's sub-tree for the current route.
 * Falls back to default.tsx if no match, or null if no default.
 *
 * When a match is found, the element is wrapped with:
 * 1. Error boundaries from each segment in the slot's matched chain
 * 2. Layouts from each segment in the slot's matched chain
 * 3. SlotAccessGate if the slot root has access.ts
 */
export async function resolveSlotElement(
  slotNode: ManifestSegmentNode,
  match: RouteMatch,
  paramsPromise: Promise<Record<string, string | string[]>>,
  h: CreateElementFn,
  interception?: InterceptionContext
): Promise<React.ReactElement | null> {
  // When interception is active, try to match intercepting children in this
  // slot against the target pathname. If an intercepting child matches, render
  // it instead of the normal slot match. This enables the modal pattern:
  // the slot shows the intercepted content on soft navigation.
  const slotMatch = interception
    ? (findInterceptingMatch(slotNode, interception.targetPathname) ??
      findSlotMatch(slotNode, match))
    : findSlotMatch(slotNode, match);

  if (slotMatch) {
    const mod = (await slotMatch.page.load()) as Record<string, unknown>;
    if (mod.default) {
      const SlotPage = mod.default as (...args: unknown[]) => unknown;
      let element: React.ReactElement = h(SlotPage, {
        params: paramsPromise,
        searchParams: {},
      });

      // Wrap with error boundaries and layouts from intermediate slot segments
      // (everything between slot root and leaf). Process innermost-first, same
      // order as route-element-builder.ts handles main segments. The slot root
      // (index 0) is handled separately after the access gate below.
      for (let i = slotMatch.chain.length - 1; i > 0; i--) {
        const seg = slotMatch.chain[i];

        // Error boundaries from this segment
        element = await wrapSegmentWithErrorBoundaries(seg, element, h);

        // Layout from this segment
        if (seg.layout) {
          const layoutMod = (await seg.layout.load()) as Record<string, unknown>;
          if (layoutMod.default) {
            const Layout = layoutMod.default as (...args: unknown[]) => unknown;
            element = h(Layout, {
              params: paramsPromise,
              searchParams: {},
              children: element,
            });
          }
        }
      }

      // Wrap in SlotAccessGate if slot root has access.ts.
      // On denial: denied.tsx → default.tsx → null (graceful degradation).
      // See design/04-authorization.md §"Slot-Level Auth".
      if (slotNode.access) {
        const accessMod = (await slotNode.access.load()) as Record<string, unknown>;
        const accessFn = accessMod.default as
          | ((ctx: { params: Record<string, string | string[]>; searchParams: unknown }) => unknown)
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

      // Wrap with slot root's layout (outermost, outside access gate)
      if (slotNode.layout) {
        const layoutMod = (await slotNode.layout.load()) as Record<string, unknown>;
        if (layoutMod.default) {
          const Layout = layoutMod.default as (...args: unknown[]) => unknown;
          element = h(Layout, {
            params: paramsPromise,
            searchParams: {},
            children: element,
          });
        }
      }

      // Wrap with slot root's error boundaries (outermost)
      element = await wrapSegmentWithErrorBoundaries(slotNode, element, h);

      // Catch-all error boundary: ensures slot errors NEVER propagate to the
      // parent layout. Without this, a slot without error.tsx that throws
      // causes SSR's renderToReadableStream to reject, triggering renderDenyPage
      // which re-executes all layout server components (including headers() calls
      // that fail in the SSR environment). The null fallback means the slot
      // degrades to nothing — consistent with the slot access denial behavior.
      // See design/02-rendering-pipeline.md §"Slot Access Failure = Graceful Degradation"
      element = h(TimberErrorBoundary, {
        fallbackComponent: SlotErrorFallback,
        children: element,
      });

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

/** Result of matching a slot's sub-tree against the current route. */
interface SlotMatchResult {
  /** The page file at the matched leaf. */
  page: NonNullable<ManifestSegmentNode['page']>;
  /** The full chain of slot nodes traversed (slot root → … → leaf with page). */
  chain: ManifestSegmentNode[];
}

/**
 * Find a matching page in a slot's sub-tree for the current route.
 *
 * Returns the matched page AND the full chain of nodes traversed, so the
 * caller can apply error boundaries and layouts from each intermediate segment.
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
function findSlotMatch(slotNode: ManifestSegmentNode, match: RouteMatch): SlotMatchResult | null {
  const segments = match.segments as unknown as ManifestSegmentNode[];

  // Find the parent segment that owns this slot by comparing urlPaths.
  // The slot's urlPath matches its parent's urlPath (slots don't add URL depth).
  // Search BACKWARDS to find the deepest (last) matching segment. Multiple
  // segments can share the same urlPath when route groups are involved (e.g.,
  // Root urlPath='/' and (browse) urlPath='/'). The slot's parent is always
  // the deepest one — searching forward would incorrectly pick the root,
  // making remainingSegments too long and breaking slot matching.
  const slotUrlPath = slotNode.urlPath;
  let parentIndex = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
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
    if (slotNode.page) {
      return { page: slotNode.page, chain: [slotNode] };
    }
    return null;
  }

  // Walk the slot's children to match remaining URL segments.
  // Track the chain so we can apply error boundaries and layouts.
  const chain: ManifestSegmentNode[] = [slotNode];
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
    chain.push(found);
    currentNode = found;
  }

  if (currentNode.page) {
    return { page: currentNode.page, chain };
  }
  return null;
}

/**
 * Find a matching intercepting route in a slot's children for the target pathname.
 *
 * When interception is active, the pipeline has already re-matched the source URL.
 * Here we check the slot's intercepting children (e.g. `(.)photo/[id]`) against
 * the target pathname to find which intercepting page to render.
 *
 * The interceptedSegmentName tells us the first URL segment to look for in the
 * target pathname. We then walk the intercepting child's sub-tree to match
 * remaining segments.
 */
function findInterceptingMatch(
  slotNode: ManifestSegmentNode,
  targetPathname: string
): SlotMatchResult | null {
  const targetParts = targetPathname === '/' ? [] : targetPathname.slice(1).split('/');

  for (const child of slotNode.children) {
    if (child.segmentType !== 'intercepting' || !child.interceptedSegmentName) continue;

    const segName = child.interceptedSegmentName;

    // Find where the intercepted segment name appears in the target parts.
    // Search from the end since intercepted routes match the URL tail.
    let matchIdx = -1;
    for (let i = targetParts.length - 1; i >= 0; i--) {
      if (targetParts[i] === segName) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx < 0) continue;

    // Walk the intercepting child's sub-tree to match remaining target parts
    const remaining = targetParts.slice(matchIdx + 1);
    const chain: ManifestSegmentNode[] = [slotNode, child];

    if (remaining.length === 0) {
      if (child.page) {
        return { page: child.page, chain };
      }
      continue;
    }

    let currentNode = child;
    let matched = true;
    for (const part of remaining) {
      const children = currentNode.children ?? [];
      let found: ManifestSegmentNode | null = null;

      // Static match
      for (const c of children) {
        if (c.segmentType === 'static' && c.segmentName === part) {
          found = c;
          break;
        }
      }

      // Dynamic match
      if (!found) {
        for (const c of children) {
          if (c.segmentType === 'dynamic') {
            found = c;
            break;
          }
        }
      }

      // Catch-all match
      if (!found) {
        for (const c of children) {
          if (c.segmentType === 'catch-all' || c.segmentType === 'optional-catch-all') {
            found = c;
            break;
          }
        }
      }

      if (!found) {
        matched = false;
        break;
      }
      chain.push(found);
      currentNode = found;
    }

    if (matched && currentNode.page) {
      return { page: currentNode.page, chain };
    }
  }

  return null;
}
