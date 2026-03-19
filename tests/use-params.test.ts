/**
 * Tests for useParams() reactivity.
 *
 * Verifies that useParams() is reactive via useSyncExternalStore —
 * when setCurrentParams() is called, all subscribers are notified
 * so components in unchanged layouts re-render with fresh params.
 *
 * The SSR path is tested in tests/ssr-hooks.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  setCurrentParams,
  subscribe,
  getSnapshot,
} from '../packages/timber-app/src/client/use-params';

describe('useParams reactivity', () => {
  it('getSnapshot reflects setCurrentParams', () => {
    setCurrentParams({ id: '1' });
    expect(getSnapshot()).toEqual({ id: '1' });

    setCurrentParams({ id: '2', slug: 'hello' });
    expect(getSnapshot()).toEqual({ id: '2', slug: 'hello' });
  });

  it('setCurrentParams replaces the snapshot reference (not mutate)', () => {
    const params1 = { id: '1' };
    setCurrentParams(params1);
    const snap1 = getSnapshot();

    const params2 = { id: '2' };
    setCurrentParams(params2);
    const snap2 = getSnapshot();

    // Different references — React's Object.is check will detect the change
    expect(snap1).not.toBe(snap2);
    expect(snap1).toEqual({ id: '1' });
    expect(snap2).toEqual({ id: '2' });
  });

  it('setCurrentParams notifies all subscribers', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsub1 = subscribe(listener1);
    const unsub2 = subscribe(listener2);

    setCurrentParams({ slug: 'hello' });
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    setCurrentParams({ slug: 'world' });
    expect(listener1).toHaveBeenCalledTimes(2);
    expect(listener2).toHaveBeenCalledTimes(2);

    unsub1();
    unsub2();
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);

    setCurrentParams({ a: '1' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    setCurrentParams({ a: '2' });
    // Should NOT be called again after unsubscribe
    expect(listener).toHaveBeenCalledTimes(1);

    // But snapshot still updates
    expect(getSnapshot()).toEqual({ a: '2' });
  });

  it('multiple subscribers: unsubscribing one does not affect others', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const listener3 = vi.fn();

    const unsub1 = subscribe(listener1);
    const unsub2 = subscribe(listener2);
    const unsub3 = subscribe(listener3);

    setCurrentParams({ id: '42' });
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
    expect(listener3).toHaveBeenCalledTimes(1);

    // Unsub the middle one
    unsub2();

    setCurrentParams({ id: '43' });
    expect(listener1).toHaveBeenCalledTimes(2);
    expect(listener2).toHaveBeenCalledTimes(1); // not called again
    expect(listener3).toHaveBeenCalledTimes(2);

    unsub1();
    unsub3();
  });

  it('subscribe returns a cleanup function (useSyncExternalStore contract)', () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);

    expect(typeof unsub).toBe('function');
    unsub();

    // Calling unsub multiple times is safe (Set.delete on missing is a no-op)
    unsub();
  });
});
