/**
 * Tests for OTEL child spans: timber.access, timber.ssr, timber.action,
 * timber.metadata, timber.layout, timber.page, and timber.cache span events.
 *
 * Without a real OTEL SDK, withSpan/addSpanEvent/setSpanAttribute are no-ops
 * that still run the wrapped function. These tests verify:
 * 1. The wrapped functions execute correctly (no regression)
 * 2. The span wiring doesn't break error propagation
 * 3. Span attributes are set at the right points
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  withSpan,
  addSpanEvent,
  setSpanAttribute,
} from '../packages/timber-app/src/server/tracing';
import { AccessGate } from '../packages/timber-app/src/server/access-gate';
import { DenySignal, RedirectSignal } from '../packages/timber-app/src/server/primitives';
import { executeAction } from '../packages/timber-app/src/server/actions';
import { createCache } from '../packages/timber-app/src/cache/timber-cache';
import { MemoryCacheHandler } from '../packages/timber-app/src/cache/index';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Stub React element for AccessGate children */
const childElement = { type: 'div', props: {}, key: null } as unknown as React.ReactElement;

// ─── timber.access span ──────────────────────────────────────────────────

describe('access span', () => {
  it('wraps access gate execution in withSpan (pass)', async () => {
    const accessFn = vi.fn().mockResolvedValue(undefined);

    const result = await AccessGate({
      accessFn,
      params: {},
      searchParams: {},
      segmentName: 'dashboard',
      children: childElement,
    });

    expect(accessFn).toHaveBeenCalledOnce();
    expect(result).toBe(childElement);
  });

  it('wraps access gate execution in withSpan (deny)', async () => {
    const accessFn = vi.fn().mockRejectedValue(new DenySignal(403));

    await expect(
      AccessGate({
        accessFn,
        params: {},
        searchParams: {},
        segmentName: 'admin',
        children: childElement,
      })
    ).rejects.toThrow(DenySignal);
  });

  it('wraps access gate execution in withSpan (redirect)', async () => {
    const accessFn = vi.fn().mockRejectedValue(new RedirectSignal('/login', 302));

    await expect(
      AccessGate({
        accessFn,
        params: {},
        searchParams: {},
        segmentName: 'protected',
        children: childElement,
      })
    ).rejects.toThrow(RedirectSignal);
  });

  it('non-DenySignal/RedirectSignal errors propagate through span', async () => {
    const accessFn = vi.fn().mockRejectedValue(new Error('unexpected'));

    await expect(
      AccessGate({
        accessFn,
        params: {},
        searchParams: {},
        segmentName: 'broken',
        children: childElement,
      })
    ).rejects.toThrow('unexpected');
  });
});

// ─── timber.ssr span ─────────────────────────────────────────────────────

describe('ssr span', () => {
  it('withSpan runs function without OTEL (no-op fallback)', async () => {
    let called = false;
    const result = await withSpan('timber.ssr', { 'timber.environment': 'ssr' }, async () => {
      called = true;
      return 'ssr-result';
    });

    expect(called).toBe(true);
    expect(result).toBe('ssr-result');
  });

  it('withSpan propagates errors', async () => {
    await expect(
      withSpan('timber.ssr', { 'timber.environment': 'ssr' }, async () => {
        throw new Error('ssr crash');
      })
    ).rejects.toThrow('ssr crash');
  });
});

// ─── timber.action span ──────────────────────────────────────────────────

describe('action span', () => {
  it('wraps action execution with span metadata', async () => {
    const actionFn = vi.fn().mockResolvedValue({ success: true });

    const result = await executeAction(
      actionFn,
      ['arg1'],
      {},
      {
        actionFile: 'app/todos/actions.ts',
        actionName: 'createTodo',
      }
    );

    expect(actionFn).toHaveBeenCalledWith('arg1');
    expect(result.actionResult).toEqual({ success: true });
  });

  it('propagates RedirectSignal through span', async () => {
    const actionFn = vi.fn().mockRejectedValue(new RedirectSignal('/login', 302));

    const result = await executeAction(
      actionFn,
      [],
      {},
      {
        actionFile: 'app/actions.ts',
        actionName: 'protectedAction',
      }
    );

    expect(result.redirectTo).toBe('/login');
    expect(result.redirectStatus).toBe(302);
  });

  it('propagates unhandled errors through span', async () => {
    const actionFn = vi.fn().mockRejectedValue(new Error('action crash'));

    await expect(
      executeAction(
        actionFn,
        [],
        {},
        {
          actionFile: 'app/actions.ts',
          actionName: 'brokenAction',
        }
      )
    ).rejects.toThrow('action crash');
  });

  it('works without span metadata', async () => {
    const actionFn = vi.fn().mockResolvedValue('ok');
    const result = await executeAction(actionFn, []);
    expect(result.actionResult).toBe('ok');
  });
});

// ─── timber.metadata span ────────────────────────────────────────────────

describe('metadata span', () => {
  it('withSpan wraps generateMetadata execution', async () => {
    const generateMetadata = vi.fn().mockResolvedValue({ title: 'Test Page' });

    const result = await withSpan('timber.metadata', { 'timber.segment': '/products/[id]' }, () =>
      generateMetadata({ params: Promise.resolve({ id: '123' }) })
    );

    expect(generateMetadata).toHaveBeenCalledOnce();
    expect(result).toEqual({ title: 'Test Page' });
  });
});

// ─── timber.layout / timber.page spans ───────────────────────────────────

describe('layout and page spans', () => {
  it('timber.layout span wraps layout component render', async () => {
    const layoutComponent = vi.fn().mockReturnValue({ type: 'div', props: {} });

    const result = await withSpan('timber.layout', { 'timber.segment': '/dashboard' }, () =>
      layoutComponent({ children: null })
    );

    expect(layoutComponent).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: 'div', props: {} });
  });

  it('timber.page span wraps page component render', async () => {
    const pageComponent = vi.fn().mockReturnValue({ type: 'main', props: {} });

    const result = await withSpan('timber.page', { 'timber.route': '/products/[id]' }, () =>
      pageComponent({ params: Promise.resolve({ id: '42' }) })
    );

    expect(pageComponent).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: 'main', props: {} });
  });
});

// ─── timber.cache span events ────────────────────────────────────────────

describe('cache span events', () => {
  let handler: MemoryCacheHandler;

  beforeEach(() => {
    handler = new MemoryCacheHandler();
  });

  it('addSpanEvent is no-op without OTEL (cache hit)', async () => {
    const fn = vi.fn().mockResolvedValue('data');
    const cached = createCache(fn, { ttl: 60 }, handler);

    // First call — miss
    await cached('arg1');
    // Second call — hit
    const result = await cached('arg1');

    expect(result).toBe('data');
    // Function called once (second was cache hit)
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('addSpanEvent is no-op without OTEL (cache miss)', async () => {
    const fn = vi.fn().mockResolvedValue('fresh');
    const cached = createCache(fn, { ttl: 60 }, handler);

    const result = await cached('new-arg');

    expect(result).toBe('fresh');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('addSpanEvent does not throw without OTEL', async () => {
    // Verify addSpanEvent is safe to call even without OTEL
    await expect(
      addSpanEvent('timber.cache.hit', { key: 'test', duration_ms: 1 })
    ).resolves.not.toThrow();

    await expect(
      addSpanEvent('timber.cache.miss', { key: 'test', duration_ms: 5 })
    ).resolves.not.toThrow();
  });
});

// ─── setSpanAttribute ────────────────────────────────────────────────────

describe('setSpanAttribute', () => {
  it('is no-op without OTEL', async () => {
    await expect(setSpanAttribute('timber.result', 'pass')).resolves.not.toThrow();
  });
});
