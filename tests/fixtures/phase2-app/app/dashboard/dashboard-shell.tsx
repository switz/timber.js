'use client';

/**
 * Client component shell for the dashboard layout.
 *
 * Contains interactive elements for E2E tests:
 * - Sibling navigation links
 * - Scroll={false} link
 * - router.refresh() trigger button
 * - Counter for state preservation tests (segment tree merging)
 */
import { useState } from 'react';
import { Link, getRouter } from '@timber-js/app/client';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  function handleRefresh() {
    void getRouter().refresh();
  }

  return (
    <div data-testid="dashboard-layout">
      <nav>
        <Link href="/dashboard" data-testid="link-dashboard-home">
          Dashboard Home
        </Link>
        <Link href="/dashboard/settings" data-testid="link-settings">
          Settings
        </Link>
        {/* scroll={false} link — tests scroll preservation */}
        <Link href="/dashboard/settings" scroll={false} data-testid="link-no-scroll">
          Settings (no scroll)
        </Link>
      </nav>

      {/* Counter for segment merge state preservation tests */}
      <div data-testid="dashboard-counter" data-count={count}>
        Count: {count}
      </div>
      <button
        type="button"
        data-testid="dashboard-increment"
        onClick={() => setCount((c) => c + 1)}
      >
        Increment
      </button>

      <button type="button" data-testid="refresh-button" onClick={handleRefresh}>
        Refresh
      </button>

      <div>{children}</div>
    </div>
  );
}
