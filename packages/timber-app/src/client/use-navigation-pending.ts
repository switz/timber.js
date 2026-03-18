// useNavigationPending — returns true while an RSC navigation is in flight.
// See design/19-client-navigation.md §"useNavigationPending()"

import { useSyncExternalStore } from 'react';
import { getRouter } from './router-ref.js';

/**
 * Returns true while an RSC navigation is in flight.
 *
 * The pending state is true from the moment the RSC fetch starts until
 * React reconciliation completes. This includes the fetch itself,
 * RSC stream parsing, and React tree reconciliation.
 *
 * It does NOT include Suspense streaming after the shell — only the
 * initial shell reconciliation.
 *
 * ```tsx
 * 'use client'
 * import { useNavigationPending } from '@timber-js/app/client'
 *
 * export function NavBar() {
 *   const isPending = useNavigationPending()
 *   return (
 *     <nav className={isPending ? 'opacity-50' : ''}>
 *       <Link href="/dashboard">Dashboard</Link>
 *     </nav>
 *   )
 * }
 * ```
 */
export function useNavigationPending(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const router = getRouter();
      return router.onPendingChange(callback);
    },
    () => {
      try {
        return getRouter().isPending();
      } catch {
        return false;
      }
    },
    // Server snapshot — always false during SSR
    () => false
  );
}
