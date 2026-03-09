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
// import { Link } from '@timber/app/client';
// import { useNavigationPending } from '@timber/app/client';

// TODO: Replace with real timber imports once the client runtime is wired up.
// For now, use plain <a> tags and a static pending indicator.
// The E2E tests will validate behavior once the framework is functional.

export function RootShell({ children }: { children: React.ReactNode }) {
  // const pending = useNavigationPending();
  const pending = false;

  return (
    <div data-testid="root-layout">
      <nav>
        {/* Standard navigation links */}
        <a href="/dashboard" data-testid="link-dashboard">
          Dashboard
        </a>
        <a href="/todos" data-testid="link-todos">
          Todos
        </a>
        <a href="/slow-page" data-testid="link-slow-page">
          Slow Page
        </a>

        {/* Prefetch-enabled link */}
        <a href="/dashboard" data-testid="link-prefetch-dashboard">
          Dashboard (prefetch)
        </a>
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
