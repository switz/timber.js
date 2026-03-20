'use client';

// LinkStatusProvider — client component that provides per-link pending status
// via React context. Used inside <Link> to power useLinkStatus().
//
// Reads pendingUrl from NavigationContext so the pending status updates
// atomically with params/pathname in the same React commit. This prevents
// the gap where the spinner disappears before the active state updates.

import type { ReactNode } from 'react';
import { LinkStatusContext, type LinkStatus } from './use-link-status.js';
import { useNavigationContext } from './navigation-context.js';

const NOT_PENDING: LinkStatus = { pending: false };
const IS_PENDING: LinkStatus = { pending: true };

/**
 * Client component that reads the pending URL from NavigationContext and
 * provides a scoped LinkStatusContext to children. Renders no extra DOM —
 * just a context provider around children.
 *
 * Because pendingUrl lives in NavigationContext alongside params and pathname,
 * all three update in the same React commit via renderRoot(). This eliminates
 * the two-commit timing gap that existed when pendingUrl was read via
 * useSyncExternalStore (external module-level state) while params came from
 * NavigationContext (React context).
 */
export function LinkStatusProvider({ href, children }: { href: string; children: ReactNode }) {
  const navState = useNavigationContext();
  // During SSR or outside NavigationProvider, never pending
  const status = navState?.pendingUrl === href ? IS_PENDING : NOT_PENDING;

  return <LinkStatusContext.Provider value={status}>{children}</LinkStatusContext.Provider>;
}
