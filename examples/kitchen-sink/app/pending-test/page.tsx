/**
 * Slow page for testing navigation pending state.
 * Simulates a 2-second server render so useLinkStatus and
 * useNavigationPending have time to show their pending state.
 */
export default async function PendingTestPage() {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return (
    <div data-testid="pending-test-content">
      <h1 className="text-2xl font-bold mb-4">Pending Test</h1>
      <p className="text-stone-600">
        This page took 2 seconds to render on the server.
        The navigation link should have shown a pending spinner.
      </p>
    </div>
  );
}
