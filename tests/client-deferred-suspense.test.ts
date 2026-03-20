/**
 * @vitest-environment happy-dom
 *
 * Tests for client-side Suspense deferral during navigation.
 *
 * timber.js wraps the React root in a TransitionRoot component that holds
 * the current element in state. Navigation updates call
 * startTransition(() => setState(newElement)), so React keeps the old
 * committed tree visible while new Suspense boundaries resolve.
 *
 * This is the client-side equivalent of deferSuspenseFor on the server.
 * See design/05-streaming.md.
 *
 * Note: The transition tests do NOT wrap the navigation step in act().
 * React's act() forces all pending work to commit — including transitions
 * that would normally stay pending while Suspense resolves. In a real
 * browser, React processes transitions asynchronously and keeps old content
 * visible. To test this correctly, we trigger the transition directly and
 * use short timeouts to let React process the update.
 */
import { describe, expect, it, afterEach } from 'vitest';
import React, { Suspense, startTransition, use, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// React's act() reads this global to determine whether to warn about
// unacted state updates. We toggle it to avoid warnings in non-act sections.
declare global {
  // eslint-disable-next-line no-var -- must be var for globalThis augmentation
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

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

/**
 * Wrapper component that mirrors timber's TransitionRoot pattern.
 *
 * Holds the current element in React state. Navigation triggers
 * startTransition(() => setState(newElement)), which is a proper
 * transition update — React keeps the old committed tree visible
 * while new Suspense boundaries in the transition resolve.
 *
 * This is the same mechanism used in packages/timber-app/src/client/
 * transition-root.tsx.
 */
function createTransitionRoot() {
  let transitionRender: ((element: React.ReactNode) => void) | null = null;

  function TransitionRoot({ initial }: { initial: React.ReactNode }): React.ReactNode {
    const [element, setElement] = useState<React.ReactNode>(initial);
    transitionRender = (newElement: React.ReactNode) => {
      startTransition(() => {
        setElement(newElement);
      });
    };
    return element;
  }

  return {
    TransitionRoot,
    render: (element: React.ReactNode) => {
      if (transitionRender) transitionRender(element);
    },
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

  // This test validates that timber's TransitionRoot mechanism keeps old
  // content visible while new Suspense boundaries resolve during navigation.
  //
  // startTransition(() => setState(newElement)) is a proper transition update.
  // React keeps the old committed tree visible because the transition's tree
  // has a suspended Suspense boundary — React doesn't commit incomplete
  // transition trees.
  //
  // Note: We don't wrap the transition in act() because act() forces React
  // to commit all pending work, defeating the purpose of transitions.
  // In the real browser, React processes transitions asynchronously.
  it('startTransition keeps old UI visible while new Suspense boundary resolves', async () => {
    // Disable act environment warnings for the non-act portions of this test
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;

    container = document.createElement('div');
    document.body.appendChild(container);

    const { TransitionRoot, render } = createTransitionRoot();

    // Initial render: simple content (simulates "old page")
    root = createRoot(container);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await act(() => {
      root.render(
        React.createElement(TransitionRoot, {
          initial: React.createElement('div', { id: 'old' }, 'Old page'),
        })
      );
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
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

    // Navigate via TransitionRoot (mirrors timber's router flow).
    // startTransition(() => setState(newElement)) keeps old UI visible
    // because React doesn't commit transitions with suspended content.
    render(newPage);

    // Allow React to process the transition synchronously
    await new Promise((r) => setTimeout(r, 0));

    // Old content stays visible — React keeps committed tree during transition
    expect(container.textContent).toBe('Old page');

    // Resolve async content and let React process
    resolve('New page content');
    await new Promise((r) => setTimeout(r, 50));

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
