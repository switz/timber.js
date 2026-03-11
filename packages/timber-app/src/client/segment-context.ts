/**
 * Segment Context — provides layout segment position for useSelectedLayoutSegment hooks.
 *
 * Each layout in the segment tree is wrapped with a SegmentProvider that stores
 * the URL segments from root to the current layout level. The hooks read this
 * context to determine which child segments are active below the calling layout.
 *
 * The context value is intentionally minimal: just the segment path array and
 * parallel route keys. No internal cache details are exposed.
 *
 * Design docs: design/19-client-navigation.md, design/14-ecosystem.md
 */

'use client';

import { createContext, useContext, createElement, useMemo } from 'react';

// ─── Types ───────────────────────────────────────────────────────

export interface SegmentContextValue {
  /** URL segments from root to this layout (e.g. ['', 'dashboard', 'settings']) */
  segments: string[];
  /** Parallel route slot keys available at this layout level (e.g. ['sidebar', 'modal']) */
  parallelRouteKeys: string[];
}

// ─── Context ─────────────────────────────────────────────────────

const SegmentContext = createContext<SegmentContextValue | null>(null);

/** Read the segment context. Returns null if no provider is above this component. */
export function useSegmentContext(): SegmentContextValue | null {
  return useContext(SegmentContext);
}

// ─── Provider ────────────────────────────────────────────────────

interface SegmentProviderProps {
  segments: string[];
  parallelRouteKeys: string[];
  children: React.ReactNode;
}

/**
 * Wraps each layout to provide segment position context.
 * Injected by rsc-entry.ts during element tree construction.
 */
export function SegmentProvider({ segments, parallelRouteKeys, children }: SegmentProviderProps) {
  const value = useMemo(
    () => ({ segments, parallelRouteKeys }),
    // segments and parallelRouteKeys are static per layout — they don't change
    // across navigations. The layout's position in the tree is fixed.
    // Intentionally using derived keys — segments/parallelRouteKeys are static per layout
    [segments.join('/'), parallelRouteKeys.join(',')]
  );
  return createElement(SegmentContext.Provider, { value }, children);
}
