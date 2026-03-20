/**
 * NavigationContext — React context for navigation state.
 *
 * Holds the current route params and pathname, updated atomically
 * with the RSC tree on each navigation. This replaces the previous
 * useSyncExternalStore approach for useParams() and usePathname(),
 * which suffered from a timing gap: the new tree could commit before
 * the external store re-renders fired, causing a frame where both
 * old and new active states were visible simultaneously.
 *
 * By wrapping the RSC payload element in NavigationProvider inside
 * renderRoot(), the context value and the element tree are passed to
 * reactRoot.render() in the same call — atomic by construction.
 * All consumers (useParams, usePathname) see the new values in the
 * same render pass as the new tree.
 *
 * During SSR, no NavigationProvider is mounted. Hooks fall back to
 * the ALS-backed getSsrData() for per-request isolation.
 *
 * IMPORTANT: createContext and useContext are NOT available in the RSC
 * environment (React Server Components use a stripped-down React).
 * The context is lazily initialized on first access, and all functions
 * that depend on these APIs are safe to call from any environment —
 * they return null or no-op when the APIs aren't available.
 *
 * See design/19-client-navigation.md §"NavigationContext"
 */

import React, { createElement, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export interface NavigationState {
  params: Record<string, string | string[]>;
  pathname: string;
}

// ---------------------------------------------------------------------------
// Lazy context initialization
// ---------------------------------------------------------------------------

/**
 * The context is created lazily to avoid calling createContext at module
 * level. In the RSC environment, React.createContext doesn't exist —
 * calling it at import time would crash the server.
 */
let _context: React.Context<NavigationState | null> | undefined;

function getOrCreateContext(): React.Context<NavigationState | null> | undefined {
  if (_context !== undefined) return _context;
  // createContext may not exist in the RSC environment
  if (typeof React.createContext === 'function') {
    _context = React.createContext<NavigationState | null>(null);
  }
  return _context;
}

/**
 * Read the navigation context. Returns null during SSR (no provider)
 * or in the RSC environment (no context available).
 * Internal — used by useParams() and usePathname().
 */
export function useNavigationContext(): NavigationState | null {
  const ctx = getOrCreateContext();
  if (!ctx) return null;
  // useContext may not exist in the RSC environment — caller wraps in try/catch
  if (typeof React.useContext !== 'function') return null;
  return React.useContext(ctx);
}

// ---------------------------------------------------------------------------
// Provider component
// ---------------------------------------------------------------------------

export interface NavigationProviderProps {
  value: NavigationState;
  children?: ReactNode;
}

/**
 * Wraps children with NavigationContext.Provider.
 *
 * Used in browser-entry.ts renderRoot to wrap the RSC payload element
 * so that navigation state updates atomically with the tree render.
 */
export function NavigationProvider({ value, children }: NavigationProviderProps): React.ReactElement {
  const ctx = getOrCreateContext();
  if (!ctx) {
    // RSC environment — no context available. Return children as-is.
    return children as React.ReactElement;
  }
  return createElement(ctx.Provider, { value }, children);
}

// ---------------------------------------------------------------------------
// Module-level state for renderRoot to read
// ---------------------------------------------------------------------------

/**
 * Module-level navigation state. Updated by the router before calling
 * renderRoot(). The renderRoot callback reads this to create the
 * NavigationProvider with the correct values.
 *
 * This is NOT used by hooks directly — hooks read from React context.
 * This exists only as a communication channel between the router
 * (which knows the new nav state) and renderRoot (which wraps the element).
 */
let _currentNavState: NavigationState = { params: {}, pathname: '/' };

export function setNavigationState(state: NavigationState): void {
  _currentNavState = state;
}

export function getNavigationState(): NavigationState {
  return _currentNavState;
}

// ---------------------------------------------------------------------------
// Pending Navigation Context (same module for singleton guarantee)
// ---------------------------------------------------------------------------

/**
 * Separate context for the in-flight navigation URL. Provided by
 * TransitionRoot (useOptimistic state), consumed by LinkStatusProvider
 * and useNavigationPending.
 *
 * Lives in this module (not a separate file) to guarantee singleton
 * identity across chunks. The `'use client'` LinkStatusProvider and
 * the non-directive TransitionRoot both import from this module —
 * if they were in separate files, the bundler could duplicate the
 * module-level context variable across chunks.
 */
let _pendingContext: React.Context<string | null> | undefined;

function getOrCreatePendingContext(): React.Context<string | null> | undefined {
  if (_pendingContext !== undefined) return _pendingContext;
  if (typeof React.createContext === 'function') {
    _pendingContext = React.createContext<string | null>(null);
  }
  return _pendingContext;
}

/**
 * Read the pending navigation URL from context.
 * Returns null during SSR (no provider) or in the RSC environment.
 */
export function usePendingNavigationUrl(): string | null {
  const ctx = getOrCreatePendingContext();
  if (!ctx) return null;
  if (typeof React.useContext !== 'function') return null;
  return React.useContext(ctx);
}

/**
 * Provider for the pending navigation URL. Wraps children with
 * the pending context Provider.
 */
export function PendingNavigationProvider({
  value,
  children,
}: {
  value: string | null;
  children?: ReactNode;
}): React.ReactElement {
  const ctx = getOrCreatePendingContext();
  if (!ctx) {
    return children as React.ReactElement;
  }
  return createElement(ctx.Provider, { value }, children);
}
