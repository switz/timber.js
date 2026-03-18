'use client';

/**
 * Client component shell for the dashboard layout.
 *
 * Contains interactive elements for E2E tests:
 * - Sibling navigation links
 * - Scroll={false} link
 * - router.refresh() trigger button
 */
import { Link, getRouter } from '@timber-js/app/client';

export function DashboardShell({ children }: { children: React.ReactNode }) {
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

      <button type="button" data-testid="refresh-button" onClick={handleRefresh}>
        Refresh
      </button>

      <div>{children}</div>
    </div>
  );
}
