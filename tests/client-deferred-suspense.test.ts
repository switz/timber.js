/**
 * @vitest-environment happy-dom
 *
 * Tests for client-side Suspense deferral during navigation.
 *
 * Currently, deferSuspenseFor only works on the server (SSR hold).
 * On client-side navigation, React shows Suspense fallbacks immediately
 * because the new tree has fresh boundaries with no prior committed content.
 *
 * startTransition doesn't help here — React can only defer reveals for
 * boundaries that already have committed content. A root.render() with a
 * completely new Suspense boundary always shows the fallback.
 *
 * The it.fails test documents this gap. When we implement client-side
 * deferral, this test should be changed to it() and pass.
 */
import { describe, expect, it, afterEach } from 'vitest';
import React, { Suspense, startTransition, use } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a component that suspends until resolved externally. */
function createSuspendingComponent() {
  let resolve: (value: string) => void;
  const promise = new Promise<string>((r) => {
    resolve = r;
  });

  function AsyncContent() {
    const value = use(promise);
    return React.createElement('div', { 'data-testid': 'async-content' }, value);
  }

  return {
    AsyncContent,
    resolve: (value: string) => resolve(value),
    promise,
  };
}

// ─── Client-side navigation Suspense behavior ──────────────────────────────

describe('client-side deferSuspenseFor', () => {
  let root: Root;
  let container: HTMLDivElement;

  afterEach(() => {
    root?.unmount();
    container?.remove();
  });

  // This test documents the current gap: startTransition does NOT prevent
  // fallback from showing when the new tree has a fresh Suspense boundary.
  // React can only defer reveals for boundaries with existing committed content.
  //
  // When client-side deferral is implemented, change it.fails → it.
  it.fails('startTransition keeps old UI visible while new Suspense boundary resolves', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Initial render: simple content (simulates "old page")
    root = createRoot(container);
    await act(() => {
      root.render(React.createElement('div', { id: 'old' }, 'Old page'));
    });
    expect(container.textContent).toBe('Old page');

    // Create a suspending component for the "new page"
    const { AsyncContent, resolve } = createSuspendingComponent();

    const newPage = React.createElement(
      'div',
      { id: 'new' },
      React.createElement(
        Suspense,
        { fallback: React.createElement('div', null, 'Loading...') },
        React.createElement(AsyncContent, null)
      )
    );

    // Render the new page inside startTransition.
    // We'd WANT React to keep showing "Old page" while AsyncContent is pending,
    // but React shows "Loading..." because this is a new Suspense boundary.
    await act(() => {
      startTransition(() => {
        root.render(newPage);
      });
    });

    // This assertion fails: we see "Loading..." instead of "Old page"
    expect(container.textContent).toBe('Old page');

    // Resolve and verify content appears
    await act(() => {
      resolve('New page content');
    });
    expect(container.textContent).toBe('New page content');
  });

  it('without startTransition, fallback shows immediately', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    root = createRoot(container);
    await act(() => {
      root.render(React.createElement('div', { id: 'old' }, 'Old page'));
    });
    expect(container.textContent).toBe('Old page');

    const { AsyncContent, resolve } = createSuspendingComponent();

    const newPage = React.createElement(
      'div',
      { id: 'new' },
      React.createElement(
        Suspense,
        { fallback: React.createElement('div', null, 'Loading...') },
        React.createElement(AsyncContent, null)
      )
    );

    // Render WITHOUT startTransition — fallback shows immediately
    await act(() => {
      root.render(newPage);
    });

    expect(container.textContent).toBe('Loading...');

    await act(() => {
      resolve('New page content');
    });
    expect(container.textContent).toBe('New page content');
  });
});
