import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createActionClient,
  ActionError,
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
    safeParse(data: unknown): { success: true; data: T } | { success: false; error: { flatten(): { fieldErrors: Record<string, string[]> } } } {
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
      return { user: (ctx as Record<string, unknown>).user, plan: (ctx as Record<string, unknown>).plan };
    });

    const result = await myAction();
    expect(result).toEqual({
      data: { user: { id: '1' }, plan: 'pro' },
    });
  });

  it('schema validation', async () => {
    const client = createActionClient();

    const createTodo = client
      .schema(todoSchema)
      .action(async ({ input }) => {
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

    const createTodo = client
      .schema(todoSchema)
      .action(async ({ input }) => {
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

    const createTodo = client
      .schema(todoSchema)
      .action(async ({ input }) => {
        return { title: input.title };
      });

    // Simulate React useActionState calling (prevState, formData)
    const formData = new FormData();
    formData.set('title', 'Buy groceries');

    const result = await (createTodo as (prev: unknown, fd: FormData) => Promise<ActionResult<unknown>>)(null, formData);
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

  it('revalidate path payload — executeAction returns RSC payload', async () => {
    const mockPayload = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('RSC payload'));
        controller.close();
      },
    });

    const renderer = vi.fn(async () => mockPayload);

    const action = async () => {
      revalidatePath('/dashboard');
      return { ok: true };
    };

    const result = await executeAction(action, [], { renderer });

    expect(result.actionResult).toEqual({ ok: true });
    expect(result.rscPayload).toBeDefined();
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
    expect(result.rscPayload).toBeUndefined();
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
