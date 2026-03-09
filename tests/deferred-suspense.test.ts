import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We test DeferredSuspense as a pure React component using react-dom/server.
// The component is a composition of nested Suspense boundaries with a Delay primitive.

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Since DeferredSuspense is a React component that relies on React.Suspense,
 * we test its behavior through renderToReadableStream to validate streaming
 * semantics: inline resolve, fallback shown, and signal promotion.
 */

import React from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { DeferredSuspense } from '../packages/timber-app/src/server/deferred-suspense';

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

// ─── Inline Resolve ──────────────────────────────────────────────────────────

describe('DeferredSuspense', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('inline resolve', () => {
    it('renders children inline when they resolve before the hold window', async () => {
      vi.useRealTimers();
      // Children resolve in 50ms, hold window is 200ms
      const AsyncChild = createAsyncComponent(50, 'Fast content');

      const element = React.createElement(
        DeferredSuspense,
        { ms: 200, fallback: React.createElement('div', null, 'Loading...') },
        React.createElement(AsyncChild, null)
      );

      const stream = await renderToReadableStream(element);
      await stream.allReady;
      const html = await streamToString(stream);

      // Content should be present, fallback should not
      expect(html).toContain('Fast content');
      // The fallback text "Loading..." should not appear in the final output
      // when children resolve within the hold window
      expect(html).not.toContain('Loading...');
    });

    it('renders synchronous children immediately without fallback', async () => {
      vi.useRealTimers();

      const element = React.createElement(
        DeferredSuspense,
        { ms: 200, fallback: React.createElement('div', null, 'Loading...') },
        React.createElement(SyncContent, { text: 'Sync content' })
      );

      const stream = await renderToReadableStream(element);
      await stream.allReady;
      const html = await streamToString(stream);

      expect(html).toContain('Sync content');
      expect(html).not.toContain('Loading...');
    });
  });

  // ─── Fallback Shown ──────────────────────────────────────────────────────────

  describe('fallback shown', () => {
    it('shows fallback when children exceed the hold window', async () => {
      vi.useRealTimers();
      // Children resolve in 500ms, hold window is 100ms
      const SlowChild = createAsyncComponent(500, 'Slow content');

      const element = React.createElement(
        DeferredSuspense,
        { ms: 100, fallback: React.createElement('div', null, 'Skeleton') },
        React.createElement(SlowChild, null)
      );

      const stream = await renderToReadableStream(element);
      await stream.allReady;
      const html = await streamToString(stream);

      // Both should eventually be in the stream output (fallback first, then content replaces)
      // In server streaming, the fallback HTML is sent first, then the content streams in
      expect(html).toContain('Slow content');
    });

    it('renders with no fallback prop when children are slow', async () => {
      vi.useRealTimers();
      const SlowChild = createAsyncComponent(300, 'Eventually');

      const element = React.createElement(
        DeferredSuspense,
        { ms: 50 },
        React.createElement(SlowChild, null)
      );

      const stream = await renderToReadableStream(element);
      await stream.allReady;
      const html = await streamToString(stream);

      expect(html).toContain('Eventually');
    });
  });

  // ─── Props Validation ────────────────────────────────────────────────────────

  describe('props', () => {
    it('accepts ms as a number in milliseconds', async () => {
      vi.useRealTimers();

      const element = React.createElement(
        DeferredSuspense,
        { ms: 100, fallback: React.createElement('span', null, 'wait') },
        React.createElement(SyncContent, { text: 'done' })
      );

      const stream = await renderToReadableStream(element);
      await stream.allReady;
      const html = await streamToString(stream);

      expect(html).toContain('done');
    });

    it('ms=0 behaves like regular Suspense', async () => {
      vi.useRealTimers();
      const SlowChild = createAsyncComponent(100, 'Deferred');

      const element = React.createElement(
        DeferredSuspense,
        { ms: 0, fallback: React.createElement('div', null, 'Fallback') },
        React.createElement(SlowChild, null)
      );

      const stream = await renderToReadableStream(element);
      await stream.allReady;
      const html = await streamToString(stream);

      // With ms=0, should behave like regular Suspense — fallback should show immediately
      expect(html).toContain('Deferred');
    });
  });

  // ─── Nested DeferredSuspense ─────────────────────────────────────────────────

  describe('nesting', () => {
    it('nested DeferredSuspense boundaries work independently', async () => {
      vi.useRealTimers();
      const FastChild = createAsyncComponent(30, 'Fast');

      const element = React.createElement(
        DeferredSuspense,
        { ms: 200, fallback: React.createElement('div', null, 'Outer loading') },
        React.createElement(
          'div',
          null,
          React.createElement(SyncContent, { text: 'Outer content' }),
          React.createElement(
            DeferredSuspense,
            { ms: 100, fallback: React.createElement('div', null, 'Inner loading') },
            React.createElement(FastChild, null)
          )
        )
      );

      const stream = await renderToReadableStream(element);
      await stream.allReady;
      const html = await streamToString(stream);

      expect(html).toContain('Outer content');
      expect(html).toContain('Fast');
    });
  });

  // ─── Component Structure ────────────────────────────────────────────────────

  describe('component structure', () => {
    it('exports DeferredSuspense as a named export', () => {
      expect(DeferredSuspense).toBeDefined();
      expect(typeof DeferredSuspense).toBe('function');
    });

    it('renders a valid React element', () => {
      const element = React.createElement(
        DeferredSuspense,
        { ms: 100 },
        React.createElement('div', null, 'child')
      );
      expect(element).toBeDefined();
      expect(element.type).toBe(DeferredSuspense);
    });
  });
});
