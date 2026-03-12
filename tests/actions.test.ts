import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createActionClient,
  ActionError,
  handleActionError,
} from '../packages/timber-app/src/server/action-client';
import type { ActionResult } from '../packages/timber-app/src/server/action-client';
import {
  revalidatePath,
  revalidateTag,
  executeAction,
  buildNoJsResponse,
  isRscActionRequest,
  _setRevalidationState,
  _clearRevalidationState,
} from '../packages/timber-app/src/server/actions';
import type { RevalidationState } from '../packages/timber-app/src/server/actions';
import { MemoryCacheHandler } from '@timber/app/cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Zod-like schema for testing. */
function mockSchema<T>(validator: (data: unknown) => T) {
  return {
    parse(data: unknown): T {
      return validator(data);
    },
    safeParse(
      data: unknown
    ):
      | { success: true; data: T }
      | { success: false; error: { flatten(): { fieldErrors: Record<string, string[]> } } } {
      try {
        const result = validator(data);
        return { success: true, data: result };
      } catch (e) {
        return {
          success: false,
          error: {
            flatten: () => ({
              fieldErrors: { _root: [(e as Error).message] },
            }),
          },
        };
      }
    },
  };
}

/** Schema that requires { title: string } with min length 1. */
const todoSchema = mockSchema((data: unknown) => {
  const obj = data as Record<string, unknown>;
  if (!obj || typeof obj.title !== 'string' || obj.title.length < 1) {
    throw new Error('Title is required');
  }
  return { title: obj.title as string };
});

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${path}`, init);
}

// ---------------------------------------------------------------------------
// createActionClient
// ---------------------------------------------------------------------------

describe('createActionClient', () => {
  it('action client middleware', async () => {
    const client = createActionClient({
      middleware: async () => {
        return { user: { id: '1', name: 'Alice' } };
      },
    });

    const myAction = client.action(async ({ ctx }) => {
      return { userId: ctx.user.id };
    });

    const result = await myAction();
    expect(result).toEqual({ data: { userId: '1' } });
  });

  it('action client with array middleware', async () => {
    const authMw = async () => ({ user: { id: '1' } });
    const billingMw = async () => ({ plan: 'pro' });

    const client = createActionClient({
      middleware: [authMw, billingMw],
    });

    const myAction = client.action(async ({ ctx }) => {
      return {
        user: (ctx as Record<string, unknown>).user,
        plan: (ctx as Record<string, unknown>).plan,
      };
    });

    const result = await myAction();
    expect(result).toEqual({
      data: { user: { id: '1' }, plan: 'pro' },
    });
  });

  it('schema validation', async () => {
    const client = createActionClient();

    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      return { title: input.title };
    });

    // Valid input
    const good = await createTodo({ title: 'Buy groceries' });
    expect(good).toEqual({ data: { title: 'Buy groceries' } });

    // Invalid input
    const bad = await createTodo({ title: '' });
    expect(bad.validationErrors).toBeDefined();
    expect(bad.data).toBeUndefined();
  });

  it('schema validation rejects invalid input — action body never runs', async () => {
    const actionBodySpy = vi.fn();
    const client = createActionClient();

    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      actionBodySpy();
      return input;
    });

    const result = await createTodo({});
    expect(result.validationErrors).toBeDefined();
    expect(actionBodySpy).not.toHaveBeenCalled();
  });

  it('middleware ActionError short-circuits', async () => {
    const client = createActionClient({
      middleware: async () => {
        throw new ActionError('UNAUTHORIZED');
      },
    });

    const myAction = client.action(async () => {
      return 'should not reach';
    });

    const result = await myAction();
    expect(result).toEqual({
      serverError: { code: 'UNAUTHORIZED' },
    });
  });

  it('ActionError with data', async () => {
    const client = createActionClient({
      middleware: async () => {
        throw new ActionError('RATE_LIMITED', { retryAfter: 60 });
      },
    });

    const myAction = client.action(async () => 'nope');
    const result = await myAction();
    expect(result).toEqual({
      serverError: { code: 'RATE_LIMITED', data: { retryAfter: 60 } },
    });
  });

  it('unexpected error returns INTERNAL_ERROR', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const client = createActionClient();
    const myAction = client.action(async () => {
      throw new Error('secret database error');
    });

    const result = await myAction();
    expect(result).toEqual({
      serverError: { code: 'INTERNAL_ERROR' },
    });
    // No message leaked
    expect(result.serverError?.data).toBeUndefined();

    process.env.NODE_ENV = originalEnv;
  });

  it('unexpected error in dev includes message', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const client = createActionClient();
    const myAction = client.action(async () => {
      throw new Error('debug info');
    });

    const result = await myAction();
    expect(result.serverError?.code).toBe('INTERNAL_ERROR');
    expect(result.serverError?.data).toEqual({ message: 'debug info' });

    process.env.NODE_ENV = originalEnv;
  });

  it('raw use server — action without middleware', async () => {
    const client = createActionClient();

    const deleteItem = client.action(async () => {
      return { deleted: true };
    });

    const result = await deleteItem();
    expect(result).toEqual({ data: { deleted: true } });
  });

  it('FormData input from useActionState signature', async () => {
    const client = createActionClient();

    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      return { title: input.title };
    });

    // Simulate React useActionState calling (prevState, formData)
    const formData = new FormData();
    formData.set('title', 'Buy groceries');

    const result = await (
      createTodo as (prev: unknown, fd: FormData) => Promise<ActionResult<unknown>>
    )(null, formData);
    expect(result).toEqual({ data: { title: 'Buy groceries' } });
  });
});

// ---------------------------------------------------------------------------
// revalidatePath / revalidateTag
// ---------------------------------------------------------------------------

describe('revalidatePath', () => {
  beforeEach(() => {
    _clearRevalidationState();
  });

  it('throws outside action context', () => {
    expect(() => revalidatePath('/dashboard')).toThrow(
      'revalidatePath/revalidateTag called outside of a server action context'
    );
  });

  it('records path in revalidation state', () => {
    const state: RevalidationState = { paths: [], tags: [] };
    _setRevalidationState(state);

    revalidatePath('/dashboard');
    revalidatePath('/todos');

    expect(state.paths).toEqual(['/dashboard', '/todos']);
    _clearRevalidationState();
  });

  it('deduplicates paths', () => {
    const state: RevalidationState = { paths: [], tags: [] };
    _setRevalidationState(state);

    revalidatePath('/dashboard');
    revalidatePath('/dashboard');

    expect(state.paths).toEqual(['/dashboard']);
    _clearRevalidationState();
  });

  it('revalidate path payload — executeAction returns revalidation result', async () => {
    const mockRevalidation = {
      element: { type: 'div', props: { children: 'Revalidated' } },
      headElements: [],
    };

    const renderer = vi.fn(async () => mockRevalidation);

    const action = async () => {
      revalidatePath('/dashboard');
      return { ok: true };
    };

    const result = await executeAction(action, [], { renderer });

    expect(result.actionResult).toEqual({ ok: true });
    expect(result.revalidation).toBeDefined();
    expect(renderer).toHaveBeenCalledWith('/dashboard');
  });
});

describe('revalidateTag', () => {
  beforeEach(() => {
    _clearRevalidationState();
  });

  it('throws outside action context', () => {
    expect(() => revalidateTag('products')).toThrow(
      'revalidatePath/revalidateTag called outside of a server action context'
    );
  });

  it('revalidate tag — invalidates cache entries', async () => {
    const handler = new MemoryCacheHandler();
    await handler.set('product-1', { name: 'Widget' }, { ttl: 60, tags: ['products'] });
    await handler.set('product-2', { name: 'Gadget' }, { ttl: 60, tags: ['products'] });
    await handler.set('user-1', { name: 'Alice' }, { ttl: 60, tags: ['users'] });

    const action = async () => {
      revalidateTag('products');
      return { ok: true };
    };

    await executeAction(action, [], { cacheHandler: handler });

    // Products should be invalidated
    expect(await handler.get('product-1')).toBeNull();
    expect(await handler.get('product-2')).toBeNull();
    // Users should still be cached
    expect(await handler.get('user-1')).not.toBeNull();
  });

  it('deduplicates tags', () => {
    const state: RevalidationState = { paths: [], tags: [] };
    _setRevalidationState(state);

    revalidateTag('products');
    revalidateTag('products');

    expect(state.tags).toEqual(['products']);
    _clearRevalidationState();
  });
});

// ---------------------------------------------------------------------------
// revalidation redirect
// ---------------------------------------------------------------------------

describe('revalidation redirect', () => {
  it('revalidation redirect — redirect during revalidation is captured', async () => {
    const { RedirectSignal } = await import('../packages/timber-app/src/server/primitives');

    const renderer = vi.fn(async () => {
      throw new RedirectSignal('/login', 302);
    });

    const action = async () => {
      revalidatePath('/dashboard');
      return { ok: true };
    };

    const result = await executeAction(action, [], { renderer });

    expect(result.actionResult).toEqual({ ok: true });
    expect(result.redirectTo).toBe('/login');
    expect(result.redirectStatus).toBe(302);
    expect(result.revalidation).toBeUndefined();
  });

  it('redirect in action body is captured', async () => {
    const { redirect } = await import('../packages/timber-app/src/server/primitives');

    const action = async () => {
      redirect('/success');
    };

    const result = await executeAction(action, []);

    expect(result.redirectTo).toBe('/success');
    expect(result.redirectStatus).toBe(302);
  });
});

// ---------------------------------------------------------------------------
// No-JS form submission
// ---------------------------------------------------------------------------

describe('no-js form submission', () => {
  it('buildNoJsResponse returns 302 redirect', () => {
    const response = buildNoJsResponse('/todos');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/todos');
  });

  it('buildNoJsResponse with custom status', () => {
    const response = buildNoJsResponse('/login', 303);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/login');
  });

  it('isRscActionRequest detects RSC requests', () => {
    const rscReq = makeRequest('/todos', {
      method: 'POST',
      headers: { Accept: 'text/x-component' },
    });
    expect(isRscActionRequest(rscReq)).toBe(true);

    const htmlReq = makeRequest('/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(isRscActionRequest(htmlReq)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ActionError
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Concurrent action isolation (timber-b12 / timber-izg)
//
// Validates that concurrent executeAction() calls each get their own
// revalidation state — no cross-request tag/path leakage.
// ---------------------------------------------------------------------------

describe('concurrent revalidation isolation', () => {
  it('concurrent revalidateTag calls never cross-contaminate', async () => {
    const handler = new MemoryCacheHandler();
    // Seed cache entries with distinct tags
    await handler.set('a-1', { v: 'a' }, { ttl: 60, tags: ['tag-a'] });
    await handler.set('b-1', { v: 'b' }, { ttl: 60, tags: ['tag-b'] });

    // Action A: invalidates tag-a, but yields the event loop (simulates async work)
    const actionA = async () => {
      revalidateTag('tag-a');
      // Yield so Action B runs concurrently
      await new Promise((r) => setTimeout(r, 50));
      return { action: 'A' };
    };

    // Action B: invalidates tag-b, also yields
    const actionB = async () => {
      revalidateTag('tag-b');
      await new Promise((r) => setTimeout(r, 10));
      return { action: 'B' };
    };

    const [resultA, resultB] = await Promise.all([
      executeAction(actionA, [], { cacheHandler: handler }),
      executeAction(actionB, [], { cacheHandler: handler }),
    ]);

    // Each action should only see its own tag
    expect(resultA.actionResult).toEqual({ action: 'A' });
    expect(resultB.actionResult).toEqual({ action: 'B' });

    // tag-a invalidated by action A
    expect(await handler.get('a-1')).toBeNull();
    // tag-b invalidated by action B
    expect(await handler.get('b-1')).toBeNull();
  });

  it('concurrent revalidatePath calls never cross-contaminate', async () => {
    const renderer = vi.fn(async (path: string) => ({
      element: { type: 'div', props: { children: `payload:${path}` } },
      headElements: [],
    }));

    const actionA = async () => {
      revalidatePath('/dashboard');
      await new Promise((r) => setTimeout(r, 50));
      return 'A';
    };

    const actionB = async () => {
      revalidatePath('/settings');
      await new Promise((r) => setTimeout(r, 10));
      return 'B';
    };

    const [resultA, resultB] = await Promise.all([
      executeAction(actionA, [], { renderer }),
      executeAction(actionB, [], { renderer }),
    ]);

    // Each action gets its own RSC payload for its own path
    expect(resultA.actionResult).toBe('A');
    expect(resultB.actionResult).toBe('B');

    // Renderer should have been called once for each path (not both paths in one action)
    const rendererCalls = renderer.mock.calls.map((c) => c[0]);
    expect(rendererCalls).toContain('/dashboard');
    expect(rendererCalls).toContain('/settings');
    expect(renderer).toHaveBeenCalledTimes(2);
  });

  it('clearing state in one request does not affect another', async () => {
    // Action A finishes quickly, Action B takes longer.
    // When A's ALS scope ends, B's revalidation state must still be intact.
    const actionA = async () => {
      revalidateTag('fast-tag');
      return 'A';
    };

    const actionB = async () => {
      // Delay so A finishes first
      await new Promise((r) => setTimeout(r, 50));
      revalidateTag('slow-tag');
      return 'B';
    };

    const handler = new MemoryCacheHandler();
    await handler.set('fast', { v: 1 }, { ttl: 60, tags: ['fast-tag'] });
    await handler.set('slow', { v: 2 }, { ttl: 60, tags: ['slow-tag'] });

    const [resultA, resultB] = await Promise.all([
      executeAction(actionA, [], { cacheHandler: handler }),
      executeAction(actionB, [], { cacheHandler: handler }),
    ]);

    expect(resultA.actionResult).toBe('A');
    expect(resultB.actionResult).toBe('B');

    // Both tags should have been invalidated independently
    expect(await handler.get('fast')).toBeNull();
    expect(await handler.get('slow')).toBeNull();
  });

  it('20 concurrent requests with different tags — no leakage', async () => {
    const handler = new MemoryCacheHandler();
    const count = 20;

    // Seed cache entries
    for (let i = 0; i < count; i++) {
      await handler.set(`item-${i}`, { i }, { ttl: 60, tags: [`tag-${i}`] });
    }

    // Launch 20 concurrent actions, each invalidating its own tag
    const results = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        executeAction(
          async () => {
            revalidateTag(`tag-${i}`);
            // Stagger to maximize interleaving
            await new Promise((r) => setTimeout(r, Math.random() * 30));
            return i;
          },
          [],
          { cacheHandler: handler }
        )
      )
    );

    // Each action should return its own index
    for (let i = 0; i < count; i++) {
      expect(results[i].actionResult).toBe(i);
    }

    // All entries should be invalidated (each by its own action)
    for (let i = 0; i < count; i++) {
      expect(await handler.get(`item-${i}`)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// ActionError
// ---------------------------------------------------------------------------

describe('ActionError', () => {
  it('carries code and optional data', () => {
    const err = new ActionError('FORBIDDEN');
    expect(err.code).toBe('FORBIDDEN');
    expect(err.data).toBeUndefined();
    expect(err.message).toBe('ActionError: FORBIDDEN');

    const errWithData = new ActionError('RATE_LIMITED', { retryAfter: 60 });
    expect(errWithData.code).toBe('RATE_LIMITED');
    expect(errWithData.data).toEqual({ retryAfter: 60 });
  });

  it('is instanceof Error', () => {
    const err = new ActionError('TEST');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ActionError);
  });
});

// ---------------------------------------------------------------------------
// handleActionError (exported for action-handler.ts)
// ---------------------------------------------------------------------------

describe('handleActionError', () => {
  it('converts ActionError to structured serverError result', () => {
    const result = handleActionError(new ActionError('UNAUTHORIZED'));
    expect(result).toEqual({ serverError: { code: 'UNAUTHORIZED' } });
  });

  it('includes ActionError data when present', () => {
    const result = handleActionError(new ActionError('RATE_LIMITED', { retryAfter: 60 }));
    expect(result).toEqual({
      serverError: { code: 'RATE_LIMITED', data: { retryAfter: 60 } },
    });
  });

  it('returns INTERNAL_ERROR for unexpected errors in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const result = handleActionError(new Error('secret db connection string'));
    expect(result).toEqual({ serverError: { code: 'INTERNAL_ERROR' } });
    expect(result.serverError?.data).toBeUndefined();

    process.env.NODE_ENV = originalEnv;
  });

  it('includes error message in dev mode for unexpected errors', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const result = handleActionError(new Error('debug info'));
    expect(result.serverError?.code).toBe('INTERNAL_ERROR');
    expect(result.serverError?.data).toEqual({ message: 'debug info' });

    process.env.NODE_ENV = originalEnv;
  });

  it('handles non-Error thrown values', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const result = handleActionError('string error');
    expect(result).toEqual({ serverError: { code: 'INTERNAL_ERROR' } });

    process.env.NODE_ENV = originalEnv;
  });
});

// ---------------------------------------------------------------------------
// executeAction error propagation (raw 'use server' functions)
// ---------------------------------------------------------------------------

describe('executeAction error propagation', () => {
  it('re-throws ActionError from raw action (not caught by executeAction)', async () => {
    const action = async () => {
      throw new ActionError('FORBIDDEN');
    };

    // executeAction only catches RedirectSignal — everything else propagates
    await expect(executeAction(action, [])).rejects.toThrow(ActionError);
  });

  it('re-throws unexpected errors from raw action', async () => {
    const action = async () => {
      throw new Error('unexpected crash');
    };

    await expect(executeAction(action, [])).rejects.toThrow('unexpected crash');
  });

  it('still catches RedirectSignal (not affected by error handling)', async () => {
    const { redirect } = await import('../packages/timber-app/src/server/primitives');

    const action = async () => {
      redirect('/success');
    };

    // RedirectSignal should be caught and returned as redirectTo
    const result = await executeAction(action, []);
    expect(result.redirectTo).toBe('/success');
  });
});
