'use client';

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
 * Singleton guarantee: With the simplified chunking strategy (LOCAL-337),
 * this module lives in exactly one client chunk. The previous globalThis +
 * Symbol.for workaround for cross-chunk duplication is no longer needed.
 * See design/27-chunking-strategy.md.
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

let _navCtx: React.Context<NavigationState | null> | undefined;
let _pendingNavCtx: React.Context<string | null> | undefined;

function getOrCreateContext(): React.Context<NavigationState | null> | undefined {
  if (_navCtx !== undefined) return _navCtx;
  // createContext may not exist in the RSC environment
  if (typeof React.createContext === 'function') {
    _navCtx = React.createContext<NavigationState | null>(null);
    return _navCtx;
  }
  return undefined;
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
export function NavigationProvider({
  value,
  children,
}: NavigationProviderProps): React.ReactElement {
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
 * Navigation state communicated between the router and renderRoot.
 *
 * The router calls setNavigationState() before renderRoot(). The
 * renderRoot callback reads via getNavigationState() to create the
 * NavigationProvider with the correct params/pathname.
 *
 * This is NOT used by hooks directly — hooks read from React context.
 */
let _navState: NavigationState = { params: {}, pathname: '/' };

export function setNavigationState(state: NavigationState): void {
  _navState = state;
}

export function getNavigationState(): NavigationState {
  return _navState;
}

// ---------------------------------------------------------------------------
// Pending Navigation Context (same module for singleton guarantee)
// ---------------------------------------------------------------------------

/**
 * Separate context for the in-flight navigation URL. Provided by
 * TransitionRoot (urgent useState), consumed by LinkStatusProvider
 * and useNavigationPending.
 */

function getOrCreatePendingContext(): React.Context<string | null> | undefined {
  if (_pendingNavCtx !== undefined) return _pendingNavCtx;
  if (typeof React.createContext === 'function') {
    _pendingNavCtx = React.createContext<string | null>(null);
    return _pendingNavCtx;
  }
  return undefined;
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
