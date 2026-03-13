import { Suspense } from 'react';
import Counter from '../../Counter';

export const metadata = { title: 'Streaming: Deferred' };

// Hold the SSR stream for up to 500ms, allowing fast-resolving
// Suspense boundaries to render inline without showing fallbacks.
// See design/05-streaming.md §"deferSuspenseFor"
export const deferSuspenseFor = 500;

// Resolves well within the 500ms hold window — should render inline
async function FastContent() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return <div data-testid="deferred-fast-content">Fast content (resolved before deadline)</div>;
}

// Takes longer than the hold window — should show fallback then stream
async function SlowContent() {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return <div data-testid="deferred-slow-content">Slow content (streamed after deadline)</div>;
}

export default function DeferredPage() {
  return (
    <div data-testid="deferred-page" className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Deferred Suspense</h1>
        <p className="mt-1 text-sm text-stone-500">
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">deferSuspenseFor = 500ms</code> holds
          the stream so fast-resolving boundaries render inline without a loading flash.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">Shell (interactive counter)</div>
        <div data-testid="shell-counter" className="text-2xl font-semibold tabular-nums text-stone-800">
          <Counter />
        </div>
      </div>

      <Suspense fallback={<div data-testid="deferred-fast-fallback" className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-500">Fast loading...</div>}>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-xs font-medium text-emerald-600 mb-1">Fast child (50ms &lt; 500ms deadline)</div>
          <p className="text-sm text-emerald-800"><FastContent /></p>
        </div>
      </Suspense>

      <Suspense fallback={<div data-testid="deferred-slow-fallback" className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-500">Slow loading...</div>}>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs font-medium text-stone-400 mb-1">Slow child (2s &gt; 500ms deadline)</div>
          <p className="text-sm text-stone-800"><SlowContent /></p>
        </div>
      </Suspense>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          The fast child resolves within the hold window and renders inline (no fallback flash).
          The slow child exceeds the deadline — its fallback shows, then content streams in.
        </p>
      </div>
    </div>
  );
}
