/**
 * Shim: next/navigation (client environment only)
 *
 * Re-exports only the client-side hooks from timber's navigation shims.
 * Server-only functions (redirect, notFound, etc.) are excluded to prevent
 * server/primitives.ts from being pulled into the browser bundle.
 *
 * The full shim (navigation.ts) is still used in the RSC and SSR environments
 * where both client hooks and server functions are needed.
 *
 * See design/14-ecosystem.md §"next/navigation" for the full shim audit.
 */

// Hooks (client-side only)
export { useParams } from '@/client/use-params.js';
export { usePathname } from '@/client/use-pathname.js';
export { useSearchParams } from '@/client/use-search-params.js';
export { useRouter } from '@/client/use-router.js';
export {
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
} from '@/client/use-selected-layout-segment.js';

// RedirectType enum is safe (no server code dependency) and used by some
// client-side libraries for type checking.
export const RedirectType = {
  push: 'push',
  replace: 'replace',
} as const;

// Server-only stubs — throw at runtime if called from the client.
// These exist for type compatibility with libraries that import the types
// but should never execute in the browser.
export function redirect(): never {
  throw new Error(
    'redirect() is a server-only function and cannot be called from client components. ' +
      'Use useRouter().push() or useRouter().replace() for client-side navigation.'
  );
}

export function permanentRedirect(): never {
  throw new Error(
    'permanentRedirect() is a server-only function and cannot be called from client components. ' +
      'Use useRouter().push() or useRouter().replace() for client-side navigation.'
  );
}

export function notFound(): never {
  throw new Error(
    'notFound() is a server-only function and cannot be called from client components.'
  );
}
