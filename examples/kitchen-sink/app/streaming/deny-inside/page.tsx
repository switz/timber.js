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
    <div data-testid="deny-inside-page">
      <h1>deny() Inside Suspense</h1>
      <p data-testid="page-shell">This page shell renders with 200 status.</p>
      <Suspense fallback={<div data-testid="deny-suspense-fallback">Loading...</div>}>
        <DenyingContent />
      </Suspense>
    </div>
  );
}
