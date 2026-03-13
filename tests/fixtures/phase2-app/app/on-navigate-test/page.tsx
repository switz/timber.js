/**
 * Target page for onNavigate E2E tests.
 * Route: /on-navigate-test
 */
export default function OnNavigateTestPage() {
  return (
    <div data-testid="on-navigate-content">
      <h1>onNavigate Target</h1>
      <p>If you see this, navigation was not prevented.</p>
    </div>
  );
}
