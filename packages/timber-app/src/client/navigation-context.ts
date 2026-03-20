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
 * See design/19-client-navigation.md §"Navigation Flow"
 */

import { createContext, useContext, createElement, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Context type and creation
// ---------------------------------------------------------------------------

export interface NavigationState {
  params: Record<string, string | string[]>;
  pathname: string;
}

/**
 * The context value is null when no provider is mounted (SSR).
 * On the client, NavigationProvider always wraps the tree.
 */
export const NavigationContext = createContext<NavigationState | null>(null);

/**
 * Read the navigation context. Returns null during SSR (no provider).
 * Internal — used by useParams() and usePathname().
 */
export function useNavigationContext(): NavigationState | null {
  return useContext(NavigationContext);
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
  return createElement(NavigationContext.Provider, { value }, children);
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
