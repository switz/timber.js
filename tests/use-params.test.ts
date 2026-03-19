/**
 * Tests for useParams() reactivity.
 *
 * Verifies that useParams() is reactive via useSyncExternalStore —
 * when notifyParamsListeners() is called after rendering, all subscribers
 * are notified so components in preserved layouts re-render with fresh params.
 *
 * The split between setCurrentParams() and notifyParamsListeners() ensures
 * that preserved layouts don't re-render with {old tree, new params} before
 * the new RSC tree is committed. See design/19-client-navigation.md.
 *
 * The SSR path is tested in tests/ssr-hooks.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  setCurrentParams,
  notifyParamsListeners,
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

  it('setCurrentParams does NOT notify subscribers (silent update)', () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);

    setCurrentParams({ id: '1' });
    // Subscriber should NOT be called — notification is deferred
    expect(listener).toHaveBeenCalledTimes(0);

    unsub();
  });

  it('notifyParamsListeners notifies all subscribers', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsub1 = subscribe(listener1);
    const unsub2 = subscribe(listener2);

    setCurrentParams({ slug: 'hello' });
    notifyParamsListeners();
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    setCurrentParams({ slug: 'world' });
    notifyParamsListeners();
    expect(listener1).toHaveBeenCalledTimes(2);
    expect(listener2).toHaveBeenCalledTimes(2);

    unsub1();
    unsub2();
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);

    setCurrentParams({ a: '1' });
    notifyParamsListeners();
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    setCurrentParams({ a: '2' });
    notifyParamsListeners();
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
    notifyParamsListeners();
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
    expect(listener3).toHaveBeenCalledTimes(1);

    // Unsub the middle one
    unsub2();

    setCurrentParams({ id: '43' });
    notifyParamsListeners();
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

  it('deferred notification pattern: snapshot updated before notify', () => {
    // Simulates the router pattern: setCurrentParams → renderPayload → notifyParamsListeners
    const snapshotAtNotifyTime: Record<string, string | string[]>[] = [];
    const listener = vi.fn(() => {
      // When the listener fires, the snapshot should already have the new params
      snapshotAtNotifyTime.push({ ...getSnapshot() });
    });
    const unsub = subscribe(listener);

    // Step 1: Update params silently (like router does before renderPayload)
    setCurrentParams({ id: 'new-value' });
    expect(listener).not.toHaveBeenCalled();
    expect(getSnapshot()).toEqual({ id: 'new-value' }); // snapshot already updated

    // Step 2: Notify after render (like router does after renderPayload)
    notifyParamsListeners();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(snapshotAtNotifyTime[0]).toEqual({ id: 'new-value' });

    unsub();
  });
});
