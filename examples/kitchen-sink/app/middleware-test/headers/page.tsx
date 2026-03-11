export default async function HeadersPage() {
  // These headers are set by middleware.ts in this segment.
  // They'll be empty until per-route middleware execution is implemented.
  return (
    <div data-testid="middleware-headers-page">
      <h1 data-testid="middleware-headers-heading">Middleware Headers Test</h1>
      <p>This page tests that middleware.ts can set response headers.</p>
      <p data-testid="header-x-test">curl -I to see them</p>
    </div>
  );
}
