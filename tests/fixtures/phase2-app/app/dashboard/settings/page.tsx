/**
 * Dashboard settings page for Phase 2 E2E fixture app.
 * Route: /dashboard/settings
 *
 * Used as a navigation target for segment tree diff tests —
 * navigating from /dashboard to /dashboard/settings should reuse
 * the dashboard layout (sync, already mounted).
 */
export default function SettingsPage() {
  return (
    <div data-testid="settings-content">
      <h1>Settings</h1>
      <p>Dashboard settings page.</p>
    </div>
  );
}
