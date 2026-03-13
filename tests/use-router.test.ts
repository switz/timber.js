// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useRouter } from '../packages/timber-app/src/client/use-router';
import { setGlobalRouter } from '../packages/timber-app/src/client/router-ref';
import type { RouterInstance } from '../packages/timber-app/src/client/router';

function makeMockRouter(): RouterInstance {
  return {
    navigate: vi.fn(),
    refresh: vi.fn(),
    handlePopState: vi.fn(),
    isPending: vi.fn(() => false),
    getPendingUrl: vi.fn(() => null),
    onPendingChange: vi.fn(() => () => {}),
    prefetch: vi.fn(),
    applyRevalidation: vi.fn(),
    initSegmentCache: vi.fn(),
    segmentCache: {} as RouterInstance['segmentCache'],
    prefetchCache: {} as RouterInstance['prefetchCache'],
    historyStack: {} as RouterInstance['historyStack'],
  };
}

afterEach(() => {
  // Reset global router after each test
  setGlobalRouter(null as unknown as RouterInstance);
});

describe('useRouter', () => {
  it('returns a no-op router during SSR (router not initialized)', () => {
    // Router not bootstrapped — simulates SSR environment
    const router = useRouter();
    expect(router).toBeDefined();
    // No-op methods should not throw
    expect(() => router.push('/foo')).not.toThrow();
    expect(() => router.replace('/bar')).not.toThrow();
    expect(() => router.refresh()).not.toThrow();
    expect(() => router.back()).not.toThrow();
    expect(() => router.forward()).not.toThrow();
    expect(() => router.prefetch('/baz')).not.toThrow();
  });

  it('delegates to real router when bootstrapped', () => {
    const mock = makeMockRouter();
    setGlobalRouter(mock);

    const router = useRouter();
    router.push('/page');
    expect(mock.navigate).toHaveBeenCalledWith('/page', { scroll: undefined });

    router.replace('/other');
    expect(mock.navigate).toHaveBeenCalledWith('/other', { scroll: undefined, replace: true });

    router.refresh();
    expect(mock.refresh).toHaveBeenCalled();

    router.prefetch('/pre');
    expect(mock.prefetch).toHaveBeenCalledWith('/pre');
  });
});
