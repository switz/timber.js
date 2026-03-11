// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TimberNuqsAdapter } from '@timber/app/client/nuqs-adapter';

// ---------------------------------------------------------------------------
// Mock router-ref
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn<(url: string, opts?: Record<string, unknown>) => Promise<void>>();

vi.mock('@timber/app/client/router-ref', () => ({
  getRouter: () => ({
    navigate: mockNavigate,
  }),
}));

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mockNavigate.mockReset();
  mockNavigate.mockResolvedValue(undefined);

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  // Set a baseline URL
  Object.defineProperty(window, 'location', {
    writable: true,
    configurable: true,
    value: new URL('http://localhost:3000/products?page=1'),
  });

  vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  root.unmount();
  container.remove();
  vi.restoreAllMocks();
});

function renderSync(element: React.ReactNode) {
  // React 19's createRoot is async, but act() flushes synchronously
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { act } = require('react');
  act(() => {
    root.render(element);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimberNuqsAdapter', () => {
  it('renders children', () => {
    renderSync(createElement(TimberNuqsAdapter, null, createElement('div', null, 'hello')));
    expect(container.textContent).toBe('hello');
  });

  it('provides nuqs adapter context without errors', () => {
    // If the adapter is misconfigured, nuqs throws during render
    expect(() =>
      renderSync(createElement(TimberNuqsAdapter, null, createElement('span', null, 'test')))
    ).not.toThrow();
  });

  it('renders nested children correctly', () => {
    renderSync(
      createElement(
        TimberNuqsAdapter,
        null,
        createElement(
          'div',
          { 'data-testid': 'outer' },
          createElement('span', { 'data-testid': 'inner' }, 'nested')
        )
      )
    );
    expect(container.querySelector('[data-testid="outer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="inner"]')).not.toBeNull();
  });
});

describe('adapter event handling', () => {
  it('syncs with popstate events', () => {
    renderSync(createElement(TimberNuqsAdapter, null, createElement('div', null, 'content')));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { act } = require('react');
    act(() => {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: new URL('http://localhost:3000/products?page=2'),
      });
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // Adapter should have synced — no errors thrown
    expect(container.textContent).toBe('content');
  });

  it('syncs with timber:navigation-end events', () => {
    renderSync(createElement(TimberNuqsAdapter, null, createElement('div', null, 'content')));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { act } = require('react');
    act(() => {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: new URL('http://localhost:3000/dashboard?tab=settings'),
      });
      window.dispatchEvent(new CustomEvent('timber:navigation-end'));
    });

    expect(container.textContent).toBe('content');
  });

  it('does not leak listeners after unmount', () => {
    // Render and unmount, then fire events — no errors should occur
    const testContainer = document.createElement('div');
    document.body.appendChild(testContainer);
    const testRoot = createRoot(testContainer);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { act } = require('react');
    act(() => {
      testRoot.render(
        createElement(TimberNuqsAdapter, null, createElement('div', null, 'content'))
      );
    });

    act(() => {
      testRoot.unmount();
    });

    // After unmount, firing events should not cause errors
    // (listeners should have been cleaned up)
    expect(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new CustomEvent('timber:navigation-end'));
    }).not.toThrow();

    testContainer.remove();
  });
});
