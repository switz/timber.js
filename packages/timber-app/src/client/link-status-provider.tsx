'use client';

// LinkStatusProvider — client component that provides per-link pending status
// via React context. Used inside <Link> to power useLinkStatus().

import { useSyncExternalStore, type ReactNode } from 'react';
import { LinkStatusContext, type LinkStatus } from './use-link-status.js';
import { getRouter } from './router-ref.js';

const NOT_PENDING: LinkStatus = { pending: false };
const IS_PENDING: LinkStatus = { pending: true };

/**
 * Client component that subscribes to the router's pending URL and provides
 * a scoped LinkStatusContext to children. Renders no extra DOM — just a
 * context provider around children.
 */
export function LinkStatusProvider({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const status = useSyncExternalStore(
    (callback) => {
      try {
        return getRouter().onPendingChange(callback);
      } catch {
        return () => {};
      }
    },
    () => {
      try {
        const pendingUrl = getRouter().getPendingUrl();
        if (pendingUrl === href) return IS_PENDING;
        return NOT_PENDING;
      } catch {
        return NOT_PENDING;
      }
    },
    () => NOT_PENDING
  );

  return (
    <LinkStatusContext.Provider value={status}>
      {children}
    </LinkStatusContext.Provider>
  );
}
