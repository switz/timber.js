/**
 * Error boundary wrapper — wraps a React element in error boundaries from a route segment.
 *
 * Extracted to allow reuse by both rsc-entry.ts and route-element-builder.ts.
 * See design/10-error-handling.md.
 */

import { TimberErrorBoundary } from '#/client/error-boundary.js';
import type { ManifestSegmentNode } from './route-matcher.js';

/**
 * Wrap an element in error boundaries defined by a route segment.
 *
 * Processing order (innermost to outermost):
 * 1. Specific status files (e.g., 404.tsx, 500.tsx) — highest priority at runtime
 * 2. Category catch-alls (4xx.tsx, 5xx.tsx)
 * 3. error.tsx — catches anything not matched by status files
 */
export async function wrapSegmentWithErrorBoundaries(
  segment: ManifestSegmentNode,
  element: React.ReactElement,
  h: (...args: unknown[]) => React.ReactElement
): Promise<React.ReactElement> {
  // Specific status files (innermost — highest priority at runtime)
  if (segment.statusFiles) {
    for (const [key, file] of Object.entries(segment.statusFiles)) {
      if (key !== '4xx' && key !== '5xx') {
        const status = parseInt(key, 10);
        if (!isNaN(status)) {
          const mod = (await file.load()) as Record<string, unknown>;
          if (mod.default) {
            element = h(TimberErrorBoundary, {
              fallbackComponent: mod.default,
              status,
              children: element,
            });
          }
        }
      }
    }

    // Category catch-alls (4xx.tsx, 5xx.tsx)
    for (const [key, file] of Object.entries(segment.statusFiles)) {
      if (key === '4xx' || key === '5xx') {
        const mod = (await file.load()) as Record<string, unknown>;
        if (mod.default) {
          element = h(TimberErrorBoundary, {
            fallbackComponent: mod.default,
            status: key === '4xx' ? 400 : 500,
            children: element,
          });
        }
      }
    }
  }

  // error.tsx (outermost — catches anything not matched by status files)
  if (segment.error) {
    const mod = (await segment.error.load()) as Record<string, unknown>;
    if (mod.default) {
      element = h(TimberErrorBoundary, {
        fallbackComponent: mod.default,
        children: element,
      });
    }
  }

  return element;
}
