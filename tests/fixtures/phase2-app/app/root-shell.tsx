'use client';

/**
 * Client component shell for the root layout.
 *
 * Contains interactive elements needed by E2E tests:
 * - Persistent input (DOM state preservation test)
 * - Layout button (focus preservation test)
 * - Layout marker (revalidation test)
 * - Navigation pending indicator
 * - Navigation links with various test IDs
 */
import { Link } from '@timber/app/client';
import { useNavigationPending } from '@timber/app/client';

export function RootShell({ children }: { children: React.ReactNode }) {
  const pending = useNavigationPending();

  return (
    <div data-testid="root-layout">
      <nav>
        {/* Standard navigation links */}
        <Link href="/dashboard" data-testid="link-dashboard">
          Dashboard
        </Link>
        <Link href="/todos" data-testid="link-todos">
          Todos
        </Link>
        <Link href="/slow-page" data-testid="link-slow-page">
          Slow Page
        </Link>

        {/* Prefetch-enabled link */}
        <Link href="/dashboard" prefetch data-testid="link-prefetch-dashboard">
          Dashboard (prefetch)
        </Link>
      </nav>

      {/* Persistent input — tests DOM state preservation */}
      <input
        type="text"
        data-testid="layout-input"
        placeholder="Type here to test state preservation"
      />

      {/* Persistent button — tests focus preservation */}
      <button type="button" data-testid="layout-button">
        Layout Button
      </button>

      {/* Layout marker — tests revalidation (data-id stays stable without revalidation) */}
      <div data-testid="layout-marker" data-id={String(Date.now())} />

      {/* Navigation pending indicator */}
      <div
        data-testid="nav-pending"
        style={{ display: pending ? 'block' : 'none' }}
        aria-hidden={!pending}
      >
        Loading…
      </div>

      <main>{children}</main>
    </div>
  );
}
