'use client';

// LinkStatusProvider — client component that provides per-link pending status
// via React context. Used inside <Link> to power useLinkStatus().
//
// Reads pendingUrl from PendingNavigationContext (provided by TransitionRoot).
// The pending URL is set as an URGENT update at navigation start (shows
// immediately) and cleared inside startTransition when the new tree commits
// (atomic with params/pathname). This eliminates both:
// 1. The delay before showing the spinner (urgent update, not deferred)
// 2. The gap between spinner disappearing and active state updating (same commit)

import type { ReactNode } from 'react';
import { LinkStatusContext, type LinkStatus } from './use-link-status.js';
import { usePendingNavigationUrl } from './navigation-context.js';

const NOT_PENDING: LinkStatus = { pending: false };
const IS_PENDING: LinkStatus = { pending: true };

/**
 * Client component that reads the pending URL from PendingNavigationContext
 * and provides a scoped LinkStatusContext to children. Renders no extra DOM —
 * just a context provider around children.
 */
export function LinkStatusProvider({ href, children }: { href: string; children?: ReactNode }) {
  const pendingUrl = usePendingNavigationUrl();
  const status = pendingUrl === href ? IS_PENDING : NOT_PENDING;

  return <LinkStatusContext.Provider value={status}>{children}</LinkStatusContext.Provider>;
}
