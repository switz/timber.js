import { Suspense } from 'react';

export const metadata = { title: 'Streaming: Suspense' };

async function SlowContent() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return <div data-testid="streamed-content">Content loaded after delay</div>;
}

export default function SuspensePage() {
  return (
    <div data-testid="suspense-page" className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Suspense Streaming</h1>
        <p className="mt-1 text-sm text-stone-500">
          Content outside Suspense renders in the shell and blocks the status code. Content inside
          Suspense streams after the shell flushes.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">Shell (immediate)</div>
        <p data-testid="immediate-content" className="text-sm text-stone-800">
          This content renders immediately.
        </p>
      </div>

      <Suspense
        fallback={
          <div
            data-testid="suspense-fallback"
            className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4"
          >
            <div className="text-xs font-medium text-stone-400 mb-1">Suspense fallback</div>
            <p className="text-sm text-stone-500">Loading content...</p>
          </div>
        }
      >
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs font-medium text-stone-400 mb-1">Streamed (1s delay)</div>
          <SlowContent />
        </div>
      </Suspense>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          The HTTP 200 commits when{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">onShellReady</code>{' '}
          fires. The slow content streams into the open connection afterward.
        </p>
      </div>
    </div>
  );
}
