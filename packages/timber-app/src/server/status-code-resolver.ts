/**
 * Status-code file resolver for timber.js error/denial rendering.
 *
 * Given an HTTP status code and a matched segment chain, resolves the
 * correct file to render by walking the fallback chain described in
 * design/10-error-handling.md §"Status-Code Files".
 *
 * Fallback chains:
 *
 * **4xx (deny()):**
 *   Pass 1 — status files (leaf → root): {status}.tsx → 4xx.tsx
 *   Pass 2 — legacy compat (leaf → root): not-found.tsx / forbidden.tsx / unauthorized.tsx
 *   Pass 3 — error.tsx (leaf → root)
 *   Pass 4 — framework default (returns null)
 *
 * **5xx (RenderError / unhandled):**
 *   Per-segment (leaf → root): {status}.tsx → 5xx.tsx → error.tsx
 *   Then global-error.tsx (future)
 *   Then framework default (returns null)
 */

import type { SegmentNode, RouteFile } from '../routing/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** How the status-code file was matched. */
export type StatusFileKind =
  | 'exact' // e.g. 403.tsx matched status 403
  | 'category' // e.g. 4xx.tsx matched status 403
  | 'legacy' // e.g. not-found.tsx matched status 404
  | 'error'; // error.tsx as last resort

/** Result of resolving a status-code file for a segment chain. */
export interface StatusFileResolution {
  /** The matched route file. */
  file: RouteFile;
  /** The HTTP status code (always the original status, not the file's code). */
  status: number;
  /** How the file was matched. */
  kind: StatusFileKind;
  /** Index into the segments array where the file was found. */
  segmentIndex: number;
}

/** How a slot denial file was matched. */
export type SlotDeniedKind = 'denied' | 'default';

/** Result of resolving a slot denied file. */
export interface SlotDeniedResolution {
  /** The matched route file (denied.tsx or default.tsx). */
  file: RouteFile;
  /** Slot name without @ prefix. */
  slotName: string;
  /** How the file was matched. */
  kind: SlotDeniedKind;
}

// ─── Legacy Compat Mapping ───────────────────────────────────────────────────

/**
 * Maps legacy file convention names to their corresponding HTTP status codes.
 * Only used in the 4xx fallback chain.
 */
const LEGACY_FILE_TO_STATUS: Record<string, number> = {
  'not-found': 404,
  'forbidden': 403,
  'unauthorized': 401,
};

// ─── Resolver ────────────────────────────────────────────────────────────────

/**
 * Resolve the status-code file to render for a given HTTP status code.
 *
 * Walks the segment chain from leaf to root following the fallback chain
 * defined in design/10-error-handling.md. Returns null if no file is found
 * (caller should render the framework default).
 *
 * @param status - The HTTP status code (4xx or 5xx).
 * @param segments - The matched segment chain from root (index 0) to leaf (last).
 */
export function resolveStatusFile(
  status: number,
  segments: ReadonlyArray<SegmentNode>
): StatusFileResolution | null {
  if (status >= 400 && status <= 499) {
    return resolve4xx(status, segments);
  }
  if (status >= 500 && status <= 599) {
    return resolve5xx(status, segments);
  }
  return null;
}

/**
 * 4xx fallback chain (three separate passes):
 *   Pass 1 — status files (leaf → root): {status}.tsx → 4xx.tsx
 *   Pass 2 — legacy compat (leaf → root): not-found.tsx / forbidden.tsx / unauthorized.tsx
 *   Pass 3 — error.tsx (leaf → root)
 */
function resolve4xx(
  status: number,
  segments: ReadonlyArray<SegmentNode>
): StatusFileResolution | null {
  const statusStr = String(status);

  // Pass 1: status files across all segments (leaf → root)
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment.statusFiles) continue;

    // Exact match first
    const exact = segment.statusFiles.get(statusStr);
    if (exact) {
      return { file: exact, status, kind: 'exact', segmentIndex: i };
    }

    // Category catch-all
    const category = segment.statusFiles.get('4xx');
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
        const file = segment.legacyStatusFiles.get(name);
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
 * 5xx fallback chain (single pass, per-segment):
 *   At each segment (leaf → root): {status}.tsx → 5xx.tsx → error.tsx
 */
function resolve5xx(
  status: number,
  segments: ReadonlyArray<SegmentNode>
): StatusFileResolution | null {
  const statusStr = String(status);

  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];

    // Exact status file
    if (segment.statusFiles) {
      const exact = segment.statusFiles.get(statusStr);
      if (exact) {
        return { file: exact, status, kind: 'exact', segmentIndex: i };
      }

      // Category catch-all
      const category = segment.statusFiles.get('5xx');
      if (category) {
        return { file: category, status, kind: 'category', segmentIndex: i };
      }
    }

    // error.tsx at this segment level (for 5xx, checked per-segment)
    if (segment.error) {
      return { file: segment.error, status, kind: 'error', segmentIndex: i };
    }
  }

  return null;
}

// ─── Slot Denied Resolver ────────────────────────────────────────────────────

/**
 * Resolve the denial file for a parallel route slot.
 *
 * Slot denial is graceful degradation — no HTTP status on the wire.
 * Fallback chain: denied.tsx → default.tsx → null.
 *
 * @param slotNode - The segment node for the slot (segmentType === 'slot').
 */
export function resolveSlotDenied(slotNode: SegmentNode): SlotDeniedResolution | null {
  const slotName = slotNode.segmentName.replace(/^@/, '');

  if (slotNode.denied) {
    return { file: slotNode.denied, slotName, kind: 'denied' };
  }

  if (slotNode.default) {
    return { file: slotNode.default, slotName, kind: 'default' };
  }

  return null;
}
