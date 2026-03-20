/**
 * PendingNavigationContext — React context for the in-flight navigation URL.
 *
 * Provided by TransitionRoot. The value is the URL being navigated to,
 * or null when idle. Used by:
 * - LinkStatusProvider to show per-link pending spinners
 * - useNavigationPending to return a global pending boolean
 *
 * The pending URL is set as an URGENT update (shows immediately) and
 * cleared inside startTransition (commits atomically with the new tree).
 * This ensures pending state appears instantly on navigation start and
 * disappears in the same React commit as the new params/tree.
 *
 * Separate from NavigationContext (which holds params + pathname) because
 * the pending URL is managed as React state in TransitionRoot, while
 * params/pathname are set via module-level state read by renderRoot.
 * Both contexts commit together in the same transition.
 *
 * See design/19-client-navigation.md §"NavigationContext"
 */

import React, { createElement, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Lazy context initialization (same pattern as NavigationContext)
// ---------------------------------------------------------------------------

let _context: React.Context<string | null> | undefined;

function getOrCreateContext(): React.Context<string | null> | undefined {
  if (_context !== undefined) return _context;
  if (typeof React.createContext === 'function') {
    _context = React.createContext<string | null>(null);
  }
  return _context;
}

/**
 * Read the pending navigation URL from context.
 * Returns null during SSR (no provider) or in the RSC environment.
 * Internal — used by LinkStatusProvider and useNavigationPending.
 */
export function usePendingNavigationUrl(): string | null {
  const ctx = getOrCreateContext();
  if (!ctx) return null;
  if (typeof React.useContext !== 'function') return null;
  return React.useContext(ctx);
}

// ---------------------------------------------------------------------------
// Provider component
// ---------------------------------------------------------------------------

export function PendingNavigationProvider({
  value,
  children,
}: {
  value: string | null;
  children?: ReactNode;
}): React.ReactElement {
  const ctx = getOrCreateContext();
  if (!ctx) {
    return children as React.ReactElement;
  }
  return createElement(ctx.Provider, { value }, children);
}
