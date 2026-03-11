// Segment Cache — stores the mounted segment tree and prefetched payloads
// See design/19-client-navigation.md for architecture details.

import type { HeadElement } from './head';

// ─── Types ───────────────────────────────────────────────────────

/** A prefetched RSC result with optional head elements for metadata updates. */
export interface PrefetchResult {
  payload: unknown;
  headElements: HeadElement[] | null;
}

/**
 * A node in the client-side segment tree. Each node represents a mounted
 * layout or page segment with its RSC flight payload.
 */
export interface SegmentNode {
  /** The segment's URL pattern (e.g., "/", "/dashboard", "/projects/[id]") */
  segment: string;
  /** The RSC flight payload for this segment (opaque to the cache) */
  payload: unknown;
  /** Whether the segment is async (async layouts always re-render on navigation) */
  isAsync: boolean;
  /** Child segments keyed by segment path */
  children: Map<string, SegmentNode>;
}

/**
 * Serialized state tree sent via X-Timber-State-Tree header.
 * Only sync segments are included — async segments always re-render.
 */
export interface StateTree {
  segments: string[];
}

// ─── Segment Cache ───────────────────────────────────────────────

/**
 * Maintains the client-side segment tree representing currently mounted
 * layouts and pages. Used for navigation reconciliation — the router diffs
 * new routes against this tree to determine which segments to re-fetch.
 */
export class SegmentCache {
  private root: SegmentNode | undefined;

  get(segment: string): SegmentNode | undefined {
    if (segment === '/' || segment === this.root?.segment) {
      return this.root;
    }
    return undefined;
  }

  set(segment: string, node: SegmentNode): void {
    if (segment === '/' || !this.root) {
      this.root = node;
    }
  }

  clear(): void {
    this.root = undefined;
  }

  /**
   * Serialize the mounted segment tree for the X-Timber-State-Tree header.
   * Only includes sync segments — async segments are excluded because the
   * server must always re-render them (they may depend on request context).
   *
   * This is a performance optimization only, NOT a security boundary.
   * The server always runs all access.ts files regardless of the state tree.
   */
  serializeStateTree(): StateTree {
    const segments: string[] = [];
    if (this.root) {
      collectSyncSegments(this.root, segments);
    }
    return { segments };
  }
}

/** Recursively collect sync segment paths from the tree */
function collectSyncSegments(node: SegmentNode, out: string[]): void {
  if (!node.isAsync) {
    out.push(node.segment);
  }
  for (const child of node.children.values()) {
    collectSyncSegments(child, out);
  }
}

// ─── Prefetch Cache ──────────────────────────────────────────────

interface PrefetchEntry {
  result: PrefetchResult;
  expiresAt: number;
}

/**
 * Short-lived cache for hover-triggered prefetches. Entries expire after
 * 30 seconds. When a link is clicked, the prefetched payload is consumed
 * (moved to the history stack) and removed from this cache.
 *
 * timber.js does NOT prefetch on viewport intersection — only explicit
 * hover on <Link prefetch> triggers a prefetch.
 */
export class PrefetchCache {
  private static readonly TTL_MS = 30_000;
  private entries = new Map<string, PrefetchEntry>();

  set(url: string, result: PrefetchResult): void {
    this.entries.set(url, {
      result,
      expiresAt: Date.now() + PrefetchCache.TTL_MS,
    });
  }

  get(url: string): PrefetchResult | undefined {
    const entry = this.entries.get(url);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(url);
      return undefined;
    }
    return entry.result;
  }

  /** Get and remove the entry (used when navigation consumes a prefetch) */
  consume(url: string): PrefetchResult | undefined {
    const result = this.get(url);
    if (result !== undefined) {
      this.entries.delete(url);
    }
    return result;
  }
}
