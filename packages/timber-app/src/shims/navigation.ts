/**
 * Shim: next/navigation → timber navigation primitives
 *
 * Client hooks use #/ source imports (individual files with 'use client' directives
 * that the RSC plugin detects).
 * Server functions use @timber-js/app/server (resolved to dist/ via native exports)
 * for ALS singleton consistency.
 */

// Hooks (client-side — must use source imports for RSC 'use client' detection)
export { useParams } from '#/client/use-params.js';
export { usePathname } from '#/client/use-pathname.js';
export { useSearchParams } from '#/client/use-search-params.js';
export { useRouter } from '#/client/use-router.js';
export {
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
} from '#/client/use-selected-layout-segment.js';

// Functions (server-side — resolved to dist/ for ALS singleton consistency)
export { redirect, permanentRedirect, notFound, RedirectType } from '@timber-js/app/server';
