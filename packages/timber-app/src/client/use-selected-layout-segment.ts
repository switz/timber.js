/**
 * useSelectedLayoutSegment / useSelectedLayoutSegments — client-side hooks
 * for reading the active segment(s) below the current layout.
 *
 * These hooks are used by navigation UIs to highlight active sections.
 * They match Next.js's API from next/navigation.
 *
 * How they work:
 * 1. Each layout is wrapped with a SegmentProvider that records its depth
 *    (the URL segments from root to that layout level).
 * 2. The hooks read the current URL pathname via usePathname().
 * 3. They compare the layout's segment depth against the full URL segments
 *    to determine which child segments are "selected" below.
 *
 * Example: For URL "/dashboard/settings/profile"
 * - Root layout (depth 0, segments: ['']): selected segment = "dashboard"
 * - Dashboard layout (depth 1, segments: ['', 'dashboard']): selected = "settings"
 * - Settings layout (depth 2, segments: ['', 'dashboard', 'settings']): selected = "profile"
 *
 * Design docs: design/19-client-navigation.md, design/14-ecosystem.md
 */

'use client';

import { useSegmentContext } from './segment-context.js';
import { usePathname } from './use-pathname.js';

/**
 * Split a pathname into URL segments.
 * "/" → [""]
 * "/dashboard" → ["", "dashboard"]
 * "/dashboard/settings" → ["", "dashboard", "settings"]
 */
export function pathnameToSegments(pathname: string): string[] {
  return pathname.split('/');
}

/**
 * Pure function: compute the selected child segment given a layout's segment
 * depth and the current URL pathname.
 *
 * @param contextSegments — segments from root to the calling layout, or null if no context
 * @param pathname — current URL pathname
 * @returns the active child segment one level below, or null if at the leaf
 */
export function getSelectedSegment(
  contextSegments: string[] | null,
  pathname: string
): string | null {
  const urlSegments = pathnameToSegments(pathname);

  if (!contextSegments) {
    return urlSegments[1] || null;
  }

  const depth = contextSegments.length;
  return urlSegments[depth] || null;
}

/**
 * Pure function: compute all selected segments below a layout's depth.
 *
 * @param contextSegments — segments from root to the calling layout, or null if no context
 * @param pathname — current URL pathname
 * @returns all active segments below the layout
 */
export function getSelectedSegments(contextSegments: string[] | null, pathname: string): string[] {
  const urlSegments = pathnameToSegments(pathname);

  if (!contextSegments) {
    return urlSegments.slice(1).filter(Boolean);
  }

  const depth = contextSegments.length;
  return urlSegments.slice(depth).filter(Boolean);
}

/**
 * Returns the active child segment one level below the layout where this
 * hook is called. Returns `null` if the layout is the leaf (no child segment).
 *
 * Compatible with Next.js's `useSelectedLayoutSegment()` from `next/navigation`.
 *
 * @param parallelRouteKey — Optional parallel route key. Currently unused
 *   (parallel route segment tracking is not yet implemented). Accepted for
 *   API compatibility with Next.js.
 */
export function useSelectedLayoutSegment(parallelRouteKey?: string): string | null {
  void parallelRouteKey;
  const context = useSegmentContext();
  const pathname = usePathname();
  return getSelectedSegment(context?.segments ?? null, pathname);
}

/**
 * Returns all active segments below the layout where this hook is called.
 * Returns an empty array if the layout is the leaf (no child segments).
 *
 * Compatible with Next.js's `useSelectedLayoutSegments()` from `next/navigation`.
 *
 * @param parallelRouteKey — Optional parallel route key. Currently unused
 *   (parallel route segment tracking is not yet implemented). Accepted for
 *   API compatibility with Next.js.
 */
export function useSelectedLayoutSegments(parallelRouteKey?: string): string[] {
  void parallelRouteKey;
  const context = useSegmentContext();
  const pathname = usePathname();
  return getSelectedSegments(context?.segments ?? null, pathname);
}
