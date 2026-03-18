'use client';

// useLinkStatus — returns { pending: true } while the nearest parent <Link>'s
// navigation is in flight. No arguments — scoped via React context.
// See design/19-client-navigation.md §"useLinkStatus()"

import { useContext, createContext } from 'react';

export interface LinkStatus {
  pending: boolean;
}

/**
 * React context provided by <Link>. Holds the pending status
 * for that specific link's navigation.
 */
export const LinkStatusContext = createContext<LinkStatus>({ pending: false });

/**
 * Returns `{ pending: true }` while the nearest parent `<Link>` component's
 * navigation is in flight. Must be used inside a `<Link>` component's children.
 *
 * Unlike `useNavigationPending()` which is global, this hook is scoped to
 * the nearest parent `<Link>` — only the link the user clicked shows pending.
 *
 * ```tsx
 * 'use client'
 * import { Link, useLinkStatus } from '@timber-js/app/client'
 *
 * function Hint() {
 *   const { pending } = useLinkStatus()
 *   return <span className={pending ? 'opacity-50' : ''} />
 * }
 *
 * export function NavLink({ href, children }) {
 *   return (
 *     <Link href={href}>
 *       {children} <Hint />
 *     </Link>
 *   )
 * }
 * ```
 */
export function useLinkStatus(): LinkStatus {
  return useContext(LinkStatusContext);
}
