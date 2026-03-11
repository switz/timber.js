import { DeferredSuspense } from '@timber/app/server';
import Counter from '../../Counter';

export const metadata = { title: 'Streaming: Deferred' };

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
    <div data-testid="deferred-page">
      <h1>DeferredSuspense</h1>

      <section>
        <h2>Interactive counter (in shell, outside Suspense)</h2>
        <div data-testid="shell-counter">
          <Counter />
        </div>
      </section>

      <section>
        <h2>Fast child (resolves before deadline)</h2>
        <DeferredSuspense
          ms={500}
          fallback={<div data-testid="deferred-fast-fallback">Fast loading...</div>}
        >
          <FastContent />
        </DeferredSuspense>
      </section>

      <section>
        <h2>Slow child (exceeds deadline)</h2>
        <DeferredSuspense
          ms={500}
          fallback={<div data-testid="deferred-slow-fallback">Slow loading...</div>}
        >
          <SlowContent />
        </DeferredSuspense>
      </section>
    </div>
  );
}
