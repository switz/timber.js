/**
 * Manifest-compatible status-code file resolver.
 *
 * The existing status-code-resolver.ts works with SegmentNode (Map-based).
 * This module works with ManifestSegmentNode (object-based) for use at
 * runtime in the RSC/SSR entries, where the route manifest provides
 * plain objects instead of Maps.
 *
 * Supports two format families:
 * - 'component' (default): .tsx/.jsx/.mdx status files → React rendering pipeline
 * - 'json': .json status files → raw JSON response, no React
 *
 * Follows the same fallback chains as status-code-resolver.ts:
 *
 * **Component chain (4xx):**
 *   Pass 1 — status files (leaf → root): {status}.tsx → 4xx.tsx
 *   Pass 2 — legacy compat (leaf → root): not-found.tsx / forbidden.tsx / unauthorized.tsx
 *   Pass 3 — error.tsx (leaf → root)
 *   Pass 4 — framework default (returns null)
 *
 * **JSON chain (4xx):**
 *   Pass 1 — json status files (leaf → root): {status}.json → 4xx.json
 *   Pass 2 — framework default JSON (returns null, caller provides bare JSON)
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

/** Response format family for status-code resolution. */
export type ManifestStatusFileFormat = 'component' | 'json';

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
 * @param status - The HTTP status code (4xx or 5xx).
 * @param segments - The matched segment chain from root (index 0) to leaf (last).
 * @param format - The response format family ('component' or 'json'). Defaults to 'component'.
 */
export function resolveManifestStatusFile(
  status: number,
  segments: ReadonlyArray<ManifestSegmentNode>,
  format: ManifestStatusFileFormat = 'component'
): ManifestStatusFileResolution | null {
  if (status < 400 || status > 599) {
    return null;
  }

  if (format === 'json') {
    return resolveJson(status, segments);
  }

  if (status <= 499) {
    return resolve4xx(status, segments);
  }

  return resolve5xx(status, segments);
}

/**
 * 4xx component fallback chain (three separate passes):
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

/**
 * 5xx component fallback chain (single pass, per-segment):
 *   At each segment (leaf → root): {status}.tsx → 5xx.tsx → error.tsx
 */
function resolve5xx(
  status: number,
  segments: ReadonlyArray<ManifestSegmentNode>
): ManifestStatusFileResolution | null {
  const statusStr = String(status);

  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];

    if (segment.statusFiles) {
      const exact = segment.statusFiles[statusStr];
      if (exact) {
        return { file: exact, status, kind: 'exact', segmentIndex: i };
      }

      const categoryKey = '5xx';
      const category = segment.statusFiles[categoryKey];
      if (category) {
        return { file: category, status, kind: 'category', segmentIndex: i };
      }
    }

    if (segment.error) {
      return { file: segment.error, status, kind: 'error', segmentIndex: i };
    }
  }

  return null;
}

/**
 * JSON fallback chain (for both 4xx and 5xx):
 *   At each segment (leaf → root): {status}.json → {category}.json
 *   No legacy compat, no error.tsx — JSON chain terminates at category catch-all.
 */
function resolveJson(
  status: number,
  segments: ReadonlyArray<ManifestSegmentNode>
): ManifestStatusFileResolution | null {
  const statusStr = String(status);
  const categoryKey = status >= 500 ? '5xx' : '4xx';

  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment.jsonStatusFiles) continue;

    const exact = segment.jsonStatusFiles[statusStr];
    if (exact) {
      return { file: exact, status, kind: 'exact', segmentIndex: i };
    }

    const category = segment.jsonStatusFiles[categoryKey];
    if (category) {
      return { file: category, status, kind: 'category', segmentIndex: i };
    }
  }

  return null;
}
