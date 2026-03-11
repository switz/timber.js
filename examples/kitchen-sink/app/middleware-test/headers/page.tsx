import { headers } from '@timber/app/server';

export default async function HeadersPage() {
  const reqHeaders = headers();
  // These headers are set by middleware.ts in this segment.
  // They'll be empty until per-route middleware execution is implemented.
  const xTest = reqHeaders.get('X-Test');
  return (
    <div data-testid="middleware-headers-page">
      <h1 data-testid="middleware-headers-heading">Middleware Headers Test</h1>
      <p>This page tests that middleware.ts can set response headers.</p>
      <p data-testid="header-x-test">{xTest ?? '(not set)'}</p>
    </div>
  );
}
