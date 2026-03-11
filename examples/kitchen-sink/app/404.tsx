'use client';

// Root 404 page — renders when deny(404) is called outside Suspense.
// Per design/10-error-handling.md, receives { status, dangerouslyPassData }.
export default function NotFound({
  status,
  dangerouslyPassData,
}: {
  status: number;
  dangerouslyPassData?: unknown;
}) {
  return (
    <div data-testid="not-found-page">
      <h1 data-testid="not-found-heading">404 — Page Not Found</h1>
      <p data-testid="not-found-status">Status: {status}</p>
      {dangerouslyPassData != null && (
        <pre data-testid="not-found-data">{JSON.stringify(dangerouslyPassData)}</pre>
      )}
    </div>
  );
}
