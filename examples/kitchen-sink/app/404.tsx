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
    <div data-testid="not-found-page" className="max-w-lg space-y-4">
      <div>
        <h1 data-testid="not-found-heading" className="text-2xl font-bold text-stone-900">
          404 — Page Not Found
        </h1>
        <p data-testid="not-found-status" className="mt-1 text-sm text-stone-500">
          Status: {status}
        </p>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          This is the root{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">404.tsx</code>.
          timber.js returned a real HTTP 404 — not a 200 with a &ldquo;not found&rdquo; message.
        </p>
      </div>
      {dangerouslyPassData != null && (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs font-medium text-stone-400 mb-1">dangerouslyPassData</div>
          <pre
            data-testid="not-found-data"
            className="text-sm font-mono text-stone-700 overflow-x-auto"
          >
            {JSON.stringify(dangerouslyPassData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
