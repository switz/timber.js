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
import { useRef, useEffect } from 'react';
import { Link } from '@timber/app/client';
import { useNavigationPending } from '@timber/app/client';

export function RootShell({ children }: { children: React.ReactNode }) {
  const pending = useNavigationPending();
  const markerRef = useRef<HTMLDivElement>(null);

  // Stamp a unique ID after mount — avoids hydration mismatch from Date.now()
  // while still giving tests a value that stays stable without revalidation.
  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.setAttribute('data-id', String(Date.now()));
    }
  }, []);

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
        <Link href="/parallel" data-testid="link-parallel">
          Parallel
        </Link>
        <Link href="/hmr-test" data-testid="link-hmr-test">
          HMR Test
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
      <div data-testid="layout-marker" ref={markerRef} />

      {/* Navigation pending indicator */}
      <div
        data-testid="nav-pending"
        style={{ position: 'fixed', top: 8, right: 8, display: pending ? 'block' : 'none' }}
        aria-hidden={!pending}
      >
        Loading…
      </div>

      <main>{children}</main>
    </div>
  );
}
