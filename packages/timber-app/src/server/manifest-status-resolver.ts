/**
 * Manifest-compatible status-code file resolver.
 *
 * The existing status-code-resolver.ts works with SegmentNode (Map-based).
 * This module works with ManifestSegmentNode (object-based) for use at
 * runtime in the RSC/SSR entries, where the route manifest provides
 * plain objects instead of Maps.
 *
 * Follows the same fallback chains as status-code-resolver.ts:
 *
 * **4xx (deny()):**
 *   Pass 1 — status files (leaf → root): {status}.tsx → 4xx.tsx
 *   Pass 2 — legacy compat (leaf → root): not-found.tsx / forbidden.tsx / unauthorized.tsx
 *   Pass 3 — error.tsx (leaf → root)
 *   Pass 4 — framework default (returns null)
 *
 * See design/10-error-handling.md §"Status-Code Files"
 */

import type { ManifestSegmentNode } from './route-matcher.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A file reference in the manifest (lazy import + path). */
interface ManifestFile {
  load: () => Promise<unknown>;
  filePath: string;
}

/** How the status-code file was matched. */
export type ManifestStatusFileKind =
  | 'exact' // e.g. 403.tsx matched status 403
  | 'category' // e.g. 4xx.tsx matched status 403
  | 'legacy' // e.g. not-found.tsx matched status 404
  | 'error'; // error.tsx as last resort

/** Result of resolving a status-code file from manifest segments. */
export interface ManifestStatusFileResolution {
  /** The matched manifest file (has load() and filePath). */
  file: ManifestFile;
  /** The HTTP status code (always the original status, not the file's code). */
  status: number;
  /** How the file was matched. */
  kind: ManifestStatusFileKind;
  /** Index into the segments array where the file was found. */
  segmentIndex: number;
}

// ─── Legacy Compat Mapping ───────────────────────────────────────────────────

const LEGACY_FILE_TO_STATUS: Record<string, number> = {
  'not-found': 404,
  'forbidden': 403,
  'unauthorized': 401,
};

// ─── Resolver ────────────────────────────────────────────────────────────────

/**
 * Resolve the status-code file to render for a given HTTP status code,
 * using manifest segment nodes (plain objects, not Maps).
 *
 * Only handles 4xx status codes (from deny()). 5xx errors use a separate
 * path through RenderError / error boundaries.
 *
 * @param status - The HTTP status code (4xx).
 * @param segments - The matched segment chain from root (index 0) to leaf (last).
 */
export function resolveManifestStatusFile(
  status: number,
  segments: ReadonlyArray<ManifestSegmentNode>
): ManifestStatusFileResolution | null {
  if (status < 400 || status > 499) {
    return null;
  }
  return resolve4xx(status, segments);
}

/**
 * 4xx fallback chain (three separate passes):
 *   Pass 1 — status files (leaf → root): {status}.tsx → 4xx.tsx
 *   Pass 2 — legacy compat (leaf → root): not-found.tsx / forbidden.tsx / unauthorized.tsx
 *   Pass 3 — error.tsx (leaf → root)
 */
function resolve4xx(
  status: number,
  segments: ReadonlyArray<ManifestSegmentNode>
): ManifestStatusFileResolution | null {
  const statusStr = String(status);

  // Pass 1: status files across all segments (leaf → root)
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment.statusFiles) continue;

    // Exact match first
    const exact = segment.statusFiles[statusStr];
    if (exact) {
      return { file: exact, status, kind: 'exact', segmentIndex: i };
    }

    // Category catch-all
    const category = segment.statusFiles['4xx'];
    if (category) {
      return { file: category, status, kind: 'category', segmentIndex: i };
    }
  }

  // Pass 2: legacy compat files (leaf → root)
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment.legacyStatusFiles) continue;

    for (const [name, legacyStatus] of Object.entries(LEGACY_FILE_TO_STATUS)) {
      if (legacyStatus === status) {
        const file = segment.legacyStatusFiles[name];
        if (file) {
          return { file, status, kind: 'legacy', segmentIndex: i };
        }
      }
    }
  }

  // Pass 3: error.tsx (leaf → root)
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].error) {
      return { file: segments[i].error!, status, kind: 'error', segmentIndex: i };
    }
  }

  return null;
}
