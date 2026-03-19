// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useRouter } from '../packages/timber-app/src/client/use-router';
import { setGlobalRouter, getRouterOrNull } from '../packages/timber-app/src/client/router-ref';
import type { RouterInstance } from '../packages/timber-app/src/client/router';

function makeMockRouter(): RouterInstance {
  return {
    navigate: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
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
  delete (window as any).__timber_router;
});

describe('useRouter', () => {
  it('returns safe no-ops before bootstrap (router not initialized)', () => {
    // Router not bootstrapped — simulates SSR or pre-bootstrap client.
    // Methods lazily resolve the router and silently no-op if not available.
    const router = useRouter();
    expect(router).toBeDefined();
    expect(() => router.push('/foo')).not.toThrow();
    expect(() => router.replace('/bar')).not.toThrow();
    expect(() => router.refresh()).not.toThrow();
    expect(() => router.back()).not.toThrow();
    expect(() => router.forward()).not.toThrow();
    expect(() => router.prefetch('/baz')).not.toThrow();
  });

  it('push triggers router.navigate with correct args', async () => {
    const mock = makeMockRouter();
    setGlobalRouter(mock);

    const router = useRouter();
    router.push('/page');

    // navigate is called inside startTransition — wait for microtask flush
    await vi.waitFor(() => {
      expect(mock.navigate).toHaveBeenCalledWith('/page', { scroll: undefined });
    });
  });

  it('replace triggers router.navigate with replace option', async () => {
    const mock = makeMockRouter();
    setGlobalRouter(mock);

    const router = useRouter();
    router.replace('/other');

    await vi.waitFor(() => {
      expect(mock.navigate).toHaveBeenCalledWith('/other', { scroll: undefined, replace: true });
    });
  });

  it('refresh triggers router.refresh', async () => {
    const mock = makeMockRouter();
    setGlobalRouter(mock);

    const router = useRouter();
    router.refresh();

    await vi.waitFor(() => {
      expect(mock.refresh).toHaveBeenCalled();
    });
  });

  it('prefetch delegates directly (not via startTransition)', () => {
    const mock = makeMockRouter();
    setGlobalRouter(mock);

    const router = useRouter();
    router.prefetch('/pre');

    // prefetch is synchronous — called immediately without startTransition
    expect(mock.prefetch).toHaveBeenCalledWith('/pre');
  });

  it('push actually awaits router.navigate (not fire-and-forget)', async () => {
    // Verify that navigate is called and its promise is tracked.
    // Before the fix, `void router.navigate()` discarded the promise,
    // meaning the RSC fetch might not complete.
    let resolveNavigate!: () => void;
    const navigatePromise = new Promise<void>((resolve) => {
      resolveNavigate = resolve;
    });
    const mock = makeMockRouter();
    mock.navigate = vi.fn().mockReturnValue(navigatePromise);
    setGlobalRouter(mock);

    const router = useRouter();
    router.push('/dashboard');

    // navigate was called inside startTransition
    await vi.waitFor(() => {
      expect(mock.navigate).toHaveBeenCalledWith('/dashboard', { scroll: undefined });
    });

    // Resolve the navigation promise (simulating RSC fetch completion)
    resolveNavigate();
    await navigatePromise;
  });

  it('push passes scroll: false through to navigate', async () => {
    const mock = makeMockRouter();
    setGlobalRouter(mock);

    const router = useRouter();
    router.push('/page', { scroll: false });

    await vi.waitFor(() => {
      expect(mock.navigate).toHaveBeenCalledWith('/page', { scroll: false });
    });
  });
});
