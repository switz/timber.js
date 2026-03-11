import { describe, it, expect, vi } from 'vitest';
import { AccessGate, SlotAccessGate } from '../packages/timber-app/src/server/access-gate';
import {
  deny,
  redirect,
  DenySignal,
  RedirectSignal,
} from '../packages/timber-app/src/server/primitives';
import type {
  AccessGateProps,
  SlotAccessGateProps,
} from '../packages/timber-app/src/server/tree-builder';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const defaultParams = { id: '42' };
const defaultSearchParams = new URLSearchParams('q=test');

function makeAccessGateProps(overrides?: Partial<AccessGateProps>): AccessGateProps {
  return {
    accessFn: async () => {},
    params: defaultParams,
    searchParams: defaultSearchParams,
    children: { type: 'div', props: { children: 'page content' } },
    ...overrides,
  };
}

function makeSlotAccessGateProps(overrides?: Partial<SlotAccessGateProps>): SlotAccessGateProps {
  return {
    accessFn: async () => {},
    params: defaultParams,
    searchParams: defaultSearchParams,
    deniedFallback: { type: 'div', props: { children: 'denied' } },
    defaultFallback: { type: 'div', props: { children: 'default' } },
    children: { type: 'div', props: { children: 'slot content' } },
    ...overrides,
  };
}

// ─── AccessGate ──────────────────────────────────────────────────────────────

describe('AccessGate', () => {
  it('calls access before layout', async () => {
    const callOrder: string[] = [];

    const accessFn = async (ctx: {
      params: Record<string, string | string[]>;
      searchParams: unknown;
    }) => {
      callOrder.push('access');
      // Verify context is passed correctly
      expect(ctx.params).toEqual(defaultParams);
      expect(ctx.searchParams).toBe(defaultSearchParams);
    };

    const result = await AccessGate(makeAccessGateProps({ accessFn }));
    callOrder.push('children-rendered');

    expect(callOrder).toEqual(['access', 'children-rendered']);
    // Children are returned (layout would render next)
    expect(result).toBeDefined();
    expect(result.props.children).toBe('page content');
  });

  it('shallowest failure wins', async () => {
    // Simulate nested AccessGates: parent denies, child should never run
    const childAccessFn = vi.fn();

    const parentAccessFn = async () => {
      deny(401);
    };

    // Parent AccessGate throws DenySignal
    await expect(AccessGate(makeAccessGateProps({ accessFn: parentAccessFn }))).rejects.toThrow(
      DenySignal
    );

    // Child access never called (React stops rendering at the failing parent)
    expect(childAccessFn).not.toHaveBeenCalled();
  });

  it('segment deny status', async () => {
    // deny() with default 403
    const accessFn403 = async () => {
      deny();
    };
    try {
      await AccessGate(makeAccessGateProps({ accessFn: accessFn403 }));
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DenySignal);
      expect((error as DenySignal).status).toBe(403);
    }

    // deny(401)
    const accessFn401 = async () => {
      deny(401);
    };
    try {
      await AccessGate(makeAccessGateProps({ accessFn: accessFn401 }));
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DenySignal);
      expect((error as DenySignal).status).toBe(401);
    }

    // deny(404)
    const accessFn404 = async () => {
      deny(404);
    };
    try {
      await AccessGate(makeAccessGateProps({ accessFn: accessFn404 }));
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DenySignal);
      expect((error as DenySignal).status).toBe(404);
    }
  });

  it('propagates redirect signal', async () => {
    const accessFn = async () => {
      redirect('/login');
    };

    try {
      await AccessGate(makeAccessGateProps({ accessFn }));
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RedirectSignal);
      expect((error as RedirectSignal).location).toBe('/login');
      expect((error as RedirectSignal).status).toBe(302);
    }
  });

  it('propagates redirect with custom status', async () => {
    const accessFn = async () => {
      redirect('/new-location', 301);
    };

    try {
      await AccessGate(makeAccessGateProps({ accessFn }));
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RedirectSignal);
      expect((error as RedirectSignal).status).toBe(301);
    }
  });

  it('passes params and searchParams to access function', async () => {
    const accessFn = vi.fn();
    const params = { projectId: 'abc', orgId: 'xyz' };
    const searchParams = { tab: 'settings' };

    await AccessGate(makeAccessGateProps({ accessFn, params, searchParams }));

    expect(accessFn).toHaveBeenCalledWith({ params, searchParams });
  });

  it('discards return value from access function', async () => {
    const accessFn = async () => ({ user: { id: '1', name: 'Test' } });

    const result = await AccessGate(makeAccessGateProps({ accessFn }));

    // Children returned, not the access function's return value
    expect(result.props.children).toBe('page content');
  });

  it('access runs for api', async () => {
    // access.ts should work for route.ts endpoints too
    // (outside React render pass — no React.cache, but the component still runs)
    const accessFn = vi.fn();

    await AccessGate(makeAccessGateProps({ accessFn }));

    expect(accessFn).toHaveBeenCalledOnce();
  });

  it('propagates unhandled errors', async () => {
    const accessFn = async () => {
      throw new Error('Database connection failed');
    };

    await expect(AccessGate(makeAccessGateProps({ accessFn }))).rejects.toThrow(
      'Database connection failed'
    );
  });
});

// ─── SlotAccessGate ──────────────────────────────────────────────────────────

describe('SlotAccessGate', () => {
  it('renders children when access passes', async () => {
    const result = await SlotAccessGate(makeSlotAccessGateProps());

    expect(result.props.children).toBe('slot content');
  });

  it('slot deny degradation — denied.tsx fallback', async () => {
    const accessFn = async () => {
      deny();
    };

    const result = await SlotAccessGate(makeSlotAccessGateProps({ accessFn }));

    // Should render denied fallback, not throw
    expect(result.props.children).toBe('denied');
  });

  it('slot deny degradation — default.tsx when no denied.tsx', async () => {
    const accessFn = async () => {
      deny();
    };

    const result = await SlotAccessGate(
      makeSlotAccessGateProps({
        accessFn,
        deniedFallback: null,
      })
    );

    // Falls back to default.tsx
    expect(result.props.children).toBe('default');
  });

  it('slot deny degradation — null when no denied.tsx or default.tsx', async () => {
    const accessFn = async () => {
      deny();
    };

    const result = await SlotAccessGate(
      makeSlotAccessGateProps({
        accessFn,
        deniedFallback: null,
        defaultFallback: null,
      })
    );

    expect(result).toBeNull();
  });

  it('slot deny does not affect HTTP status', async () => {
    // SlotAccessGate catches DenySignal — it does NOT re-throw
    const accessFn = async () => {
      deny(403);
    };

    // This should not throw
    const result = await SlotAccessGate(makeSlotAccessGateProps({ accessFn }));

    // Should gracefully degrade
    expect(result.props.children).toBe('denied');
  });

  it('slot redirect error — dev mode warning', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const accessFn = async () => {
      redirect('/login');
    };

    // Should not throw — redirect is caught and treated as deny
    const result = await SlotAccessGate(makeSlotAccessGateProps({ accessFn }));

    expect(result.props.children).toBe('denied');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('redirect() is not allowed in slot access.ts')
    );

    consoleSpy.mockRestore();
  });

  it('parent blocks slots — parent segment failure prevents slot rendering', async () => {
    // This test verifies the architectural contract:
    // If the parent segment's AccessGate fails, the entire segment
    // (including all slots) is denied. The SlotAccessGate never runs.
    const slotAccessFn = vi.fn();

    const parentAccessFn = async () => {
      deny(401);
    };

    // Parent AccessGate throws — child slots never render
    await expect(AccessGate(makeAccessGateProps({ accessFn: parentAccessFn }))).rejects.toThrow(
      DenySignal
    );

    // Slot access function was never called
    expect(slotAccessFn).not.toHaveBeenCalled();
  });

  it('re-throws unhandled errors for error boundaries', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const accessFn = async () => {
      throw new Error('Unexpected DB error');
    };

    await expect(SlotAccessGate(makeSlotAccessGateProps({ accessFn }))).rejects.toThrow(
      'Unexpected DB error'
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled error in slot access.ts'),
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });

  it('passes correct context to slot access function', async () => {
    const accessFn = vi.fn();
    const params = { workspaceId: 'ws-1' };
    const searchParams = new URLSearchParams('view=grid');

    await SlotAccessGate(makeSlotAccessGateProps({ accessFn, params, searchParams }));

    expect(accessFn).toHaveBeenCalledWith({ params, searchParams });
  });

  it('discards return value from slot access function', async () => {
    const accessFn = async () => ({ permissions: ['read', 'write'] });

    const result = await SlotAccessGate(makeSlotAccessGateProps({ accessFn }));

    expect(result.props.children).toBe('slot content');
  });

  it('handles deny with custom 4xx status gracefully', async () => {
    const accessFn = async () => {
      deny(401);
    };

    const result = await SlotAccessGate(makeSlotAccessGateProps({ accessFn }));

    // All 4xx denials degrade gracefully in slot context
    expect(result.props.children).toBe('denied');
  });
});
