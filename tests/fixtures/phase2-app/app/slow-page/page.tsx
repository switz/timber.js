/**
 * Slow page for Phase 2 E2E fixture app.
 * Route: /slow-page
 *
 * Simulates a slow server render to test the navigation pending indicator.
 * The E2E test clicks a link to this page and verifies that
 * useNavigationPending() shows a loading state while the RSC fetch is in flight.
 *
 * In a real timber app, this would be an async server component with a slow
 * data fetch. For the fixture, we simulate the delay.
 */

// TODO: Once async server components are wired up, add an artificial delay:
//   await new Promise(resolve => setTimeout(resolve, 2000));

export default function SlowPage() {
  return (
    <div data-testid="slow-page-content">
      <h1>Slow Page</h1>
      <p>This page simulates a slow server render.</p>
    </div>
  );
}
