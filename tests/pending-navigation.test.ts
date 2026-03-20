/**
 * Tests for the pending navigation state flow:
 * TransitionRoot (useOptimistic) → PendingNavigationContext → LinkStatusProvider → useLinkStatus
 *
 * Verifies that:
 * 1. PendingNavigationContext is a singleton (provider and consumer share the same context)
 * 2. usePendingNavigationUrl reads from PendingNavigationProvider
 * 3. LinkStatusProvider derives { pending: true } when pendingUrl matches href
 * 4. useNavigationPending derives true when any pendingUrl is set
 *
 * These are unit tests for the context wiring. The full useOptimistic +
 * useTransition flow (optimistic value shows during async transition,
 * reverts on commit) is a React runtime guarantee tested by React itself.
 * What we test here is that our context plumbing is correct — the provider
 * and consumer use the same context instance (singleton guarantee).
 */

// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  PendingNavigationProvider,
  usePendingNavigationUrl,
} from '../packages/timber-app/src/client/navigation-context';

import { useLinkStatus } from '../packages/timber-app/src/client/use-link-status';
import { useNavigationPending } from '../packages/timber-app/src/client/use-navigation-pending';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Render a component tree to static markup and return the text content.
 * Uses renderToStaticMarkup for synchronous rendering (no hydration needed).
 */
function renderToText(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// ─── Context Singleton Tests ─────────────────────────────────────────────────

describe('PendingNavigationContext singleton', () => {
  it('usePendingNavigationUrl reads null when no provider is mounted', () => {
    function Reader() {
      const url = usePendingNavigationUrl();
      return createElement('span', null, url === null ? 'null' : url);
    }
    const html = renderToText(createElement(Reader));
    expect(html).toBe('<span>null</span>');
  });

  it('usePendingNavigationUrl reads the value from PendingNavigationProvider', () => {
    function Reader() {
      const url = usePendingNavigationUrl();
      return createElement('span', null, url === null ? 'null' : url);
    }
    const html = renderToText(
      createElement(
        PendingNavigationProvider,
        { value: '/projects/123' },
        createElement(Reader),
      ),
    );
    expect(html).toBe('<span>/projects/123</span>');
  });

  it('usePendingNavigationUrl reads null when provider value is null', () => {
    function Reader() {
      const url = usePendingNavigationUrl();
      return createElement('span', null, url === null ? 'null' : url);
    }
    const html = renderToText(
      createElement(
        PendingNavigationProvider,
        { value: null },
        createElement(Reader),
      ),
    );
    expect(html).toBe('<span>null</span>');
  });
});

// ─── LinkStatusProvider Integration ──────────────────────────────────────────

// Import LinkStatusProvider — it's a 'use client' component but we can
// render it on the server for testing the context wiring.
// We need to import it after the context module to ensure singleton identity.
import { LinkStatusProvider } from '../packages/timber-app/src/client/link-status-provider';

describe('LinkStatusProvider reads from PendingNavigationContext', () => {
  it('returns { pending: false } when no navigation is pending', () => {
    function StatusReader() {
      const { pending } = useLinkStatus();
      return createElement('span', null, pending ? 'pending' : 'idle');
    }

    const html = renderToText(
      createElement(
        PendingNavigationProvider,
        { value: null },
        createElement(
          LinkStatusProvider,
          { href: '/projects' },
          createElement(StatusReader),
        ),
      ),
    );
    expect(html).toBe('<span>idle</span>');
  });

  it('returns { pending: true } when pendingUrl matches href', () => {
    function StatusReader() {
      const { pending } = useLinkStatus();
      return createElement('span', null, pending ? 'pending' : 'idle');
    }

    const html = renderToText(
      createElement(
        PendingNavigationProvider,
        { value: '/projects' },
        createElement(
          LinkStatusProvider,
          { href: '/projects' },
          createElement(StatusReader),
        ),
      ),
    );
    expect(html).toBe('<span>pending</span>');
  });

  it('returns { pending: false } when pendingUrl does not match href', () => {
    function StatusReader() {
      const { pending } = useLinkStatus();
      return createElement('span', null, pending ? 'pending' : 'idle');
    }

    const html = renderToText(
      createElement(
        PendingNavigationProvider,
        { value: '/settings' },
        createElement(
          LinkStatusProvider,
          { href: '/projects' },
          createElement(StatusReader),
        ),
      ),
    );
    expect(html).toBe('<span>idle</span>');
  });

  it('only the matching link shows pending when multiple links exist', () => {
    function StatusReader({ label }: { label: string }) {
      const { pending } = useLinkStatus();
      return createElement('span', null, `${label}:${pending ? 'pending' : 'idle'}`);
    }

    const html = renderToText(
      createElement(
        PendingNavigationProvider,
        { value: '/projects' },
        createElement('div', null,
          createElement(
            LinkStatusProvider,
            { href: '/projects' },
            createElement(StatusReader, { label: 'projects' }),
          ),
          createElement(
            LinkStatusProvider,
            { href: '/settings' },
            createElement(StatusReader, { label: 'settings' }),
          ),
        ),
      ),
    );
    expect(html).toContain('projects:pending');
    expect(html).toContain('settings:idle');
  });
});

// ─── useNavigationPending Integration ────────────────────────────────────────

describe('useNavigationPending reads from PendingNavigationContext', () => {
  it('returns false when no navigation is pending', () => {
    function PendingReader() {
      const isPending = useNavigationPending();
      return createElement('span', null, isPending ? 'yes' : 'no');
    }

    const html = renderToText(
      createElement(
        PendingNavigationProvider,
        { value: null },
        createElement(PendingReader),
      ),
    );
    expect(html).toBe('<span>no</span>');
  });

  it('returns true when a navigation is pending', () => {
    function PendingReader() {
      const isPending = useNavigationPending();
      return createElement('span', null, isPending ? 'yes' : 'no');
    }

    const html = renderToText(
      createElement(
        PendingNavigationProvider,
        { value: '/anywhere' },
        createElement(PendingReader),
      ),
    );
    expect(html).toBe('<span>yes</span>');
  });
});
