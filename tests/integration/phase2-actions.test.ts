/**
 * Phase 2 Integration Tests — Action Validation
 *
 * Cross-feature integration tests for createActionClient:
 *   middleware + schema + revalidation + FormData parsing
 *
 * Acceptance criteria from timber-dch.1.6: "createActionClient validation"
 *
 * Ported from acceptance criteria in timber-dch.1.6.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createActionClient,
  ActionError,
} from '../../packages/timber-app/src/server/action-client';
import type { ActionResult } from '../../packages/timber-app/src/server/action-client';
import {
  revalidatePath,
  revalidateTag,
  executeAction,
  buildNoJsResponse,
  isRscActionRequest,
  _clearRevalidationState,
} from '../../packages/timber-app/src/server/actions';
import { redirect } from '../../packages/timber-app/src/server/primitives';
import { MemoryCacheHandler } from '../../packages/timber-app/src/cache/index';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${path}`, init);
}

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
          error: { flatten: () => ({ fieldErrors: { _root: [(e as Error).message] } }) },
        };
      }
    },
  };
}

// ─── Action Validation (cross-feature: middleware + schema + revalidation) ──

describe('action validation', () => {
  beforeEach(() => {
    _clearRevalidationState();
  });

  it('middleware → schema → action → revalidation: full action lifecycle', async () => {
    const cacheHandler = new MemoryCacheHandler();
    await cacheHandler.set('product-1', { name: 'Widget' }, { ttl: 60, tags: ['products'] });

    const mockPayload = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('RSC payload'));
        controller.close();
      },
    });
    const renderer = vi.fn(async () => mockPayload);

    const client = createActionClient({
      middleware: async () => ({ user: { id: '1', role: 'admin' } }),
    });

    const schema = mockSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!obj?.name || typeof obj.name !== 'string') throw new Error('Name required');
      return { name: obj.name };
    });

    const updateProduct = client.schema(schema).action(async ({ ctx, input }) => {
      expect(ctx.user.role).toBe('admin');
      revalidatePath('/products');
      revalidateTag('products');
      return { updated: true, name: input.name };
    });

    const result = await executeAction(
      async () => updateProduct({ name: 'New Widget' }),
      [],
      { cacheHandler, renderer },
    );

    expect(result.actionResult).toEqual({ data: { updated: true, name: 'New Widget' } });
    expect(result.rscPayload).toBeDefined();
    expect(renderer).toHaveBeenCalledWith('/products');
    expect(await cacheHandler.get('product-1')).toBeNull();
  });

  it('schema validation rejects → body never runs, no revalidation', async () => {
    const renderer = vi.fn();
    const actionBody = vi.fn();

    const client = createActionClient();
    const schema = mockSchema((data: unknown) => {
      if (!data || !(data as Record<string, unknown>).title) throw new Error('Title required');
      return data as { title: string };
    });

    const createTodo = client.schema(schema).action(async ({ input }) => {
      actionBody();
      revalidatePath('/todos');
      return input;
    });

    const result = await executeAction(
      async () => createTodo({}),
      [],
      { renderer },
    );

    expect(actionBody).not.toHaveBeenCalled();
    expect(renderer).not.toHaveBeenCalled();
    const actionResult = result.actionResult as ActionResult<unknown>;
    expect(actionResult.validationErrors).toBeDefined();
  });

  it('middleware ActionError short-circuits before schema or body', async () => {
    const schemaValidator = vi.fn();
    const actionBody = vi.fn();

    const client = createActionClient({
      middleware: async () => {
        throw new ActionError('UNAUTHORIZED');
      },
    });

    const schema = mockSchema((data: unknown) => {
      schemaValidator();
      return data;
    });

    const myAction = client.schema(schema).action(async () => {
      actionBody();
      return 'nope';
    });

    const result = await executeAction(async () => myAction({}), []);

    expect(schemaValidator).not.toHaveBeenCalled();
    expect(actionBody).not.toHaveBeenCalled();
    const actionResult = result.actionResult as ActionResult<unknown>;
    expect(actionResult.serverError).toEqual({ code: 'UNAUTHORIZED' });
  });

  it('FormData parsing with schema validation (useActionState signature)', async () => {
    const client = createActionClient({
      middleware: async () => ({ userId: 'user-1' }),
    });

    const schema = mockSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!obj?.title || typeof obj.title !== 'string') throw new Error('Title required');
      return { title: obj.title };
    });

    const createTodo = client.schema(schema).action(async ({ ctx, input }) => {
      return { userId: (ctx as Record<string, unknown>).userId, title: input.title };
    });

    const formData = new FormData();
    formData.set('title', 'Integration test todo');

    const result = await (createTodo as (prev: unknown, fd: FormData) => Promise<ActionResult<unknown>>)(
      null, formData
    );
    expect(result).toEqual({ data: { userId: 'user-1', title: 'Integration test todo' } });
  });

  it('redirect in action body is captured alongside revalidation', async () => {
    // redirect() must be called in a raw action (not via createActionClient,
    // which catches all errors as serverError). This matches the design.
    const action = async () => {
      revalidatePath('/dashboard');
      redirect('/success');
    };

    const result = await executeAction(action, []);

    expect(result.redirectTo).toBe('/success');
    expect(result.redirectStatus).toBe(302);
  });

  it('no-JS form response: buildNoJsResponse + isRscActionRequest detection', () => {
    const htmlReq = makeRequest('/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(isRscActionRequest(htmlReq)).toBe(false);

    const rscReq = makeRequest('/todos', {
      method: 'POST',
      headers: { Accept: 'text/x-component' },
    });
    expect(isRscActionRequest(rscReq)).toBe(true);

    const noJsResponse = buildNoJsResponse('/todos');
    expect(noJsResponse.status).toBe(302);
    expect(noJsResponse.headers.get('Location')).toBe('/todos');
  });
});
