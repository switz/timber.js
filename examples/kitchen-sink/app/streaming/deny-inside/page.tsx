import { Suspense } from 'react';
import { deny } from '@timber/app/server';

export const metadata = { title: 'Streaming: Deny Inside Suspense' };

// deny() called inside a Suspense boundary after flush —
// per design/05-streaming.md, status is already 200.
// The error boundary renders inline and noindex meta is injected.
async function DenyingContent() {
  await new Promise((resolve) => setTimeout(resolve, 500));
  deny(404);
  return <div>This should never render</div>;
}

export default function DenyInsideSuspensePage() {
  return (
    <div data-testid="deny-inside-page" className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">deny() Inside Suspense</h1>
        <p className="mt-1 text-sm text-stone-500">
          When deny() fires inside a Suspense boundary after the shell flushes, the status code is
          already committed (200). The error boundary renders inline.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">Page shell (200 committed)</div>
        <p data-testid="page-shell" className="text-sm text-stone-800">
          This page shell renders with 200 status.
        </p>
      </div>

      <Suspense
        fallback={
          <div
            data-testid="deny-suspense-fallback"
            className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-500"
          >
            Loading...
          </div>
        }
      >
        <DenyingContent />
      </Suspense>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          This is the one case where the HTTP status is unavoidably wrong — the developer chose to
          place the denial inside Suspense. A{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">noindex</code> meta
          tag is injected.
        </p>
      </div>
    </div>
  );
}
