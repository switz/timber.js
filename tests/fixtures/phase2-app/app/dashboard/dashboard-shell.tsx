'use client';

/**
 * Client component shell for the dashboard layout.
 *
 * Contains interactive elements for E2E tests:
 * - Sibling navigation links
 * - Scroll={false} link
 * - router.refresh() trigger button
 */
// import { useRouter } from '@timber/app/client';

// TODO: Replace with real timber router once wired up.

export function DashboardShell({ children }: { children: React.ReactNode }) {
  // const router = useRouter();

  function handleRefresh() {
    // router.refresh();
    // TODO: Wire up once client router is available.
  }

  return (
    <div data-testid="dashboard-layout">
      <nav>
        <a href="/dashboard" data-testid="link-dashboard-home">
          Dashboard Home
        </a>
        <a href="/dashboard/settings" data-testid="link-settings">
          Settings
        </a>
        {/* scroll={false} link — tests scroll preservation */}
        <a href="/dashboard/settings" data-testid="link-no-scroll">
          Settings (no scroll)
        </a>
      </nav>

      <button type="button" data-testid="refresh-button" onClick={handleRefresh}>
        Refresh
      </button>

      <div>{children}</div>
    </div>
  );
}
