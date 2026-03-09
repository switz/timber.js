/**
 * Dashboard layout for Phase 2 E2E fixture app.
 * Route: /dashboard/*
 *
 * This is a sync layout — it should be SKIPPED during segment tree diffing
 * when navigating between sibling routes under /dashboard.
 *
 * Test IDs:
 * - dashboard-layout: container element (segment diff test checks data-mounted-id)
 * - link-settings: navigation to /dashboard/settings
 * - link-no-scroll: navigation with scroll={false} behavior
 * - refresh-button: triggers router.refresh() for full re-render test
 */
import { DashboardShell } from './dashboard-shell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
