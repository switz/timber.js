/**
 * Shim: next/navigation → timber navigation primitives
 *
 * Re-exports timber's navigation hooks and functions for libraries
 * that import from next/navigation. Covers the App Router API surface
 * used by ecosystem libraries (nuqs, next-intl, etc.).
 *
 * Note: nuqs imports next/navigation.js (with .js extension).
 * The timber-shims plugin strips .js before matching.
 *
 * Intentional divergences from Next.js:
 * - useRouter().replace() currently uses pushState (same as push) —
 *   timber's router doesn't distinguish push/replace yet.
 * - redirect() does not accept a RedirectType argument — timber
 *   always uses replace semantics for redirects.
 * - permanentRedirect() delegates to redirect(path, 308).
 * - useSelectedLayoutSegment/useSelectedLayoutSegments not yet
 *   implemented — requires segment tree context.
 *
 * See design/14-ecosystem.md for the full shim audit.
 */

// Hooks (client-side)
export { useParams } from '../client/use-params.js';
export { usePathname } from '../client/use-pathname.js';
export { useSearchParams } from '../client/use-search-params.js';
export { useRouter } from '../client/use-router.js';

// Functions (server-side)
export { redirect, permanentRedirect, notFound, RedirectType } from '../server/primitives.js';
