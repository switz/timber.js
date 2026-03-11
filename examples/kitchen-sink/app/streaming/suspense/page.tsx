import { Suspense } from 'react';

export const metadata = { title: 'Streaming: Suspense' };

async function SlowContent() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return <div data-testid="streamed-content">Content loaded after delay</div>;
}

export default function SuspensePage() {
  return (
    <div data-testid="suspense-page">
      <h1>Suspense Streaming</h1>
      <p data-testid="immediate-content">This content renders immediately.</p>
      <Suspense fallback={<div data-testid="suspense-fallback">Loading content...</div>}>
        <SlowContent />
      </Suspense>
    </div>
  );
}
