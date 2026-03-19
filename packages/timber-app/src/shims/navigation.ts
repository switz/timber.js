/**
 * Shim: next/navigation → timber navigation primitives
 *
 * Client hooks import from @timber-js/app/client (the public barrel) so they
 * resolve to the same module instances as user code in Vite dev. Server
 * functions import from @timber-js/app/server for ALS singleton consistency.
 */

// Hooks (client-side — imported from public barrel for module singleton)
export {
  useParams,
  usePathname,
  useSearchParams,
  useRouter,
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
} from '@timber-js/app/client';

// Functions (server-side)
export { redirect, permanentRedirect, notFound, RedirectType } from '@timber-js/app/server';
