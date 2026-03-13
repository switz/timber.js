// useLinkStatus — returns { pending: true } while a navigation to the given href is in flight.
// See design/19-client-navigation.md §"useLinkStatus()"

import { useSyncExternalStore } from 'react';
import { getRouter } from './router-ref.js';

export interface LinkStatus {
  pending: boolean;
}

/**
 * Returns `{ pending: true }` while an RSC navigation targeting `href` is
 * in flight. Unlike `useNavigationPending()` which is global, this hook is
 * scoped to a specific link — only the link the user clicked shows as pending.
 *
 * ```tsx
 * 'use client'
 * import { useLinkStatus } from '@timber/app/client'
 *
 * export function Tab({ href, children }: { href: string; children: React.ReactNode }) {
 *   const { pending } = useLinkStatus(href)
 *   return (
 *     <Link href={href} className={pending ? 'opacity-50' : ''}>
 *       {children}
 *     </Link>
 *   )
 * }
 * ```
 */
export function useLinkStatus(href: string): LinkStatus {
  return useSyncExternalStore(
    (callback) => {
      const router = getRouter();
      return router.onPendingChange(callback);
    },
    () => {
      try {
        const router = getRouter();
        const pendingUrl = router.getPendingUrl();
        return { pending: pendingUrl === href };
      } catch {
        return { pending: false };
      }
    },
    // Server snapshot — always not pending during SSR
    () => ({ pending: false })
  );
}
