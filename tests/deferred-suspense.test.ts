import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We test the deferSuspenseFor SSR hold mechanism using react-dom/server.
// The hold delays the first read of the HTML stream, allowing fast-resolving
// Suspense boundaries to render inline without fallbacks ever appearing.

// ─── Helpers ──────────────────────────────────────────────────────────────────

import React from 'react';
import { renderToReadableStream } from 'react-dom/server';

/** Collect a ReadableStream into a string. */
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

/** Create a component that resolves after a delay. */
function createAsyncComponent(delayMs: number, content: string) {
  const promise = new Promise<string>((resolve) => setTimeout(() => resolve(content), delayMs));

  return function AsyncContent() {
    const value = React.use(promise);
    return React.createElement('div', { 'data-testid': 'content' }, value);
  };
}

/** Create a component that resolves immediately. */
function SyncContent({ text }: { text: string }) {
  return React.createElement('div', { 'data-testid': 'content' }, text);
}

/**
 * Simulate the SSR hold from ssr-render.ts: race allReady against deferSuspenseFor.
 * This delays the first read so React can resolve pending Suspense boundaries
 * before the shell HTML is consumed.
 */
async function holdStream(
  stream: ReadableStream<Uint8Array>,
  deferMs: number
): Promise<ReadableStream<Uint8Array>> {
  // Prevent unhandled rejection
  const allReady = (stream as ReadableStream<Uint8Array> & { allReady: Promise<void> }).allReady;
  allReady.catch(() => {});

  if (deferMs > 0) {
    await Promise.race([allReady, new Promise<void>((r) => setTimeout(r, deferMs))]);
  }
  return stream;
}

// ─── deferSuspenseFor — Inline Resolve ──────────────────────────────────────

describe('deferSuspenseFor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('inline resolve', () => {
    it('inlines fast-resolving Suspense when hold window covers resolution', async () => {
      vi.useRealTimers();
      // Children resolve in 50ms, hold is 200ms — should inline
      const AsyncChild = createAsyncComponent(50, 'Fast content');

      const element = React.createElement(
        'div',
        null,
        React.createElement('h1', null, 'Page'),
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'Loading...') },
          React.createElement(AsyncChild, null)
        )
      );

      const stream = await renderToReadableStream(element);
      await holdStream(stream, 200);
      const html = await streamToString(stream);

      // Content should be inlined — no fallback in the HTML
      expect(html).toContain('Fast content');
      expect(html).not.toContain('Loading...');
    });

    it('renders synchronous children immediately without fallback', async () => {
      vi.useRealTimers();

      const element = React.createElement(
        'div',
        null,
        React.createElement('h1', null, 'Page'),
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'Loading...') },
          React.createElement(SyncContent, { text: 'Sync content' })
        )
      );

      const stream = await renderToReadableStream(element);
      await holdStream(stream, 200);
      const html = await streamToString(stream);

      expect(html).toContain('Sync content');
      expect(html).not.toContain('Loading...');
    });
  });

  // ─── Fallback Shown ──────────────────────────────────────────────────────────

  describe('fallback shown', () => {
    it('shows fallback when children exceed the hold window', async () => {
      vi.useRealTimers();
      // Children resolve in 500ms, hold is 100ms — fallback should show
      const SlowChild = createAsyncComponent(500, 'Slow content');

      const element = React.createElement(
        'div',
        null,
        React.createElement('h1', null, 'Page'),
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'Skeleton') },
          React.createElement(SlowChild, null)
        )
      );

      const stream = await renderToReadableStream(element);
      await holdStream(stream, 100);

      // Read the shell chunk — should contain the fallback
      const reader = stream.getReader();
      const { value: shellChunk } = await reader.read();
      const shell = new TextDecoder().decode(shellChunk);
      expect(shell).toContain('Skeleton');

      // Release the reader so allReady can finish
      reader.releaseLock();
      await stream.allReady;
      const rest = await streamToString(stream);

      // The streamed replacement content should contain the resolved children
      expect(rest).toContain('Slow content');
    });

    it('renders with no fallback prop when children are slow', async () => {
      vi.useRealTimers();
      const SlowChild = createAsyncComponent(300, 'Eventually');

      const element = React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(SlowChild, null)
      );

      const stream = await renderToReadableStream(element);
      await holdStream(stream, 50);
      await stream.allReady;
      const html = await streamToString(stream);

      expect(html).toContain('Eventually');
    });
  });

  // ─── No hold (deferSuspenseFor = 0) ───────────────────────────────────────

  describe('no hold', () => {
    it('deferSuspenseFor=0 behaves like regular Suspense', async () => {
      vi.useRealTimers();
      const SlowChild = createAsyncComponent(100, 'Deferred');

      const element = React.createElement(
        'div',
        null,
        React.createElement('h1', null, 'Page'),
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'Fallback') },
          React.createElement(SlowChild, null)
        )
      );

      const stream = await renderToReadableStream(element);
      // No hold — read immediately
      await holdStream(stream, 0);

      // Read shell — should contain fallback since no hold
      const reader = stream.getReader();
      const { value: shellChunk } = await reader.read();
      const shell = new TextDecoder().decode(shellChunk);
      expect(shell).toContain('Fallback');

      reader.releaseLock();
      await stream.allReady;
      const rest = await streamToString(stream);
      expect(rest).toContain('Deferred');
    });
  });

  // ─── Nested Suspense ──────────────────────────────────────────────────────

  describe('nesting', () => {
    it('nested Suspense boundaries work independently with hold', async () => {
      vi.useRealTimers();
      const FastChild = createAsyncComponent(30, 'Fast');

      const element = React.createElement(
        'div',
        null,
        React.createElement('h1', null, 'Page'),
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'Outer loading') },
          React.createElement(
            'div',
            null,
            React.createElement(SyncContent, { text: 'Outer content' }),
            React.createElement(
              React.Suspense,
              { fallback: React.createElement('div', null, 'Inner loading') },
              React.createElement(FastChild, null)
            )
          )
        )
      );

      const stream = await renderToReadableStream(element);
      await holdStream(stream, 200);
      const html = await streamToString(stream);

      expect(html).toContain('Outer content');
      expect(html).toContain('Fast');
    });
  });

  // ─── SSR Hold ──────────────────────────────────────────────────────────────

  describe('SSR stream hold', () => {
    it('inlines fast-resolving children when hold delays the first read', async () => {
      vi.useRealTimers();
      // Children resolve in 50ms, hold is 200ms
      const AsyncChild = createAsyncComponent(50, 'Inlined content');

      const element = React.createElement(
        'div',
        null,
        React.createElement('h1', null, 'Page'),
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'Fallback') },
          React.createElement(AsyncChild, null)
        )
      );

      const stream = await renderToReadableStream(element);
      await holdStream(stream, 200);
      const html = await streamToString(stream);

      // Content should be inlined — no fallback in the HTML at all
      expect(html).toContain('Inlined content');
      expect(html).not.toContain('Fallback');
    });

    it('shows fallback for slow children even with hold', async () => {
      vi.useRealTimers();
      // Children resolve in 500ms, hold is 200ms
      const SlowChild = createAsyncComponent(500, 'Slow content');

      const element = React.createElement(
        'div',
        null,
        React.createElement('h1', null, 'Page'),
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'Skeleton') },
          React.createElement(SlowChild, null)
        )
      );

      const stream = await renderToReadableStream(element);
      await holdStream(stream, 200);

      // Read the shell — should contain fallback since child is still pending
      const reader = stream.getReader();
      const { value: shellChunk } = await reader.read();
      const shell = new TextDecoder().decode(shellChunk);
      expect(shell).toContain('Skeleton');

      // Let the rest stream in
      reader.releaseLock();
      await stream.allReady;
      const rest = await streamToString(stream);
      expect(rest).toContain('Slow content');
    });

    it('flushes early if all Suspense boundaries resolve before deferSuspenseFor expires', async () => {
      vi.useRealTimers();
      // Children resolve in 30ms, hold is 5000ms
      // The hold should race allReady — once allReady resolves at ~30ms,
      // the stream should be readable immediately, not waiting 5s.
      const FastChild = createAsyncComponent(30, 'Quick content');

      const element = React.createElement(
        'div',
        null,
        React.createElement('h1', null, 'Page'),
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'Fallback') },
          React.createElement(FastChild, null)
        )
      );

      const stream = await renderToReadableStream(element);

      const startTime = Date.now();
      await holdStream(stream, 5000);
      const holdDuration = Date.now() - startTime;

      const html = await streamToString(stream);

      // Content should be inlined
      expect(html).toContain('Quick content');
      expect(html).not.toContain('Fallback');

      // The hold should have resolved in ~30ms (allReady wins the race),
      // NOT the full 5000ms timeout
      expect(holdDuration).toBeLessThan(1000);
    });
  });
});
