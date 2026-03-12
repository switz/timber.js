import { describe, it, expect } from 'vitest';
import {
  createActionClient,
  validated,
} from '../packages/timber-app/src/server/action-client';
import type { ActionResult } from '../packages/timber-app/src/server/action-client';
import { useFormErrors } from '../packages/timber-app/src/client/form';
import { getFormFlash, runWithFormFlash } from '../packages/timber-app/src/server/form-flash';
import type { FormFlashData } from '../packages/timber-app/src/server/form-flash';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Minimal Standard Schema implementation for testing. */
function mockStandardSchema<T>(validator: (data: unknown) => T | { issues: Array<{ message: string; path?: Array<string | { key: string }> }> }) {
  return {
    '~standard': {
      validate(value: unknown) {
        const result = validator(value);
        if (result && typeof result === 'object' && 'issues' in result) {
          return result as { issues: Array<{ message: string; path?: Array<string | { key: string }> }> };
        }
        return { value: result as T };
      },
    },
  };
}

/** Minimal legacy schema (Zod-like) for testing. */
function mockLegacySchema<T>(validator: (data: unknown) => T) {
  return {
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
    parse(data: unknown): T {
      return validator(data);
    },
  };
}

// ─── validated() ─────────────────────────────────────────────────────────

describe('validated()', () => {
  it('runs handler with validated input on success', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!obj?.title || typeof obj.title !== 'string') {
        return { issues: [{ message: 'Title is required', path: ['title'] }] };
      }
      return { title: obj.title };
    });

    const action = validated(schema, async (input) => {
      return { created: input.title };
    });

    const result = await action({ title: 'Hello' });
    expect(result).toEqual({ data: { created: 'Hello' } });
  });

  it('returns validation errors on failure', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!obj?.title) {
        return { issues: [{ message: 'Title is required', path: ['title'] }] };
      }
      return obj;
    });

    const action = validated(schema, async () => {
      return { ok: true };
    });

    const result = await action({});
    expect(result.validationErrors).toBeDefined();
    expect(result.validationErrors!.title).toContain('Title is required');
  });

  it('works with legacy schema interface', async () => {
    const schema = mockLegacySchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!obj?.name || typeof obj.name !== 'string') {
        throw new Error('Name is required');
      }
      return { name: obj.name };
    });

    const action = validated(schema, async (input) => {
      return { greeting: `Hello ${input.name}` };
    });

    const success = await action({ name: 'Alice' });
    expect(success).toEqual({ data: { greeting: 'Hello Alice' } });

    const failure = await action({});
    expect(failure.validationErrors).toBeDefined();
  });

  it('works with useActionState (prevState, formData) signature', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!obj?.title) {
        return { issues: [{ message: 'Required', path: ['title'] }] };
      }
      return obj;
    });

    const action = validated(schema, async (input) => input);

    const fd = new FormData();
    fd.append('title', 'Test');
    const result = await action(null, fd);
    expect(result.data).toBeDefined();
  });
});

// ─── submittedValues ─────────────────────────────────────────────────────

describe('submittedValues in ActionResult', () => {
  it('includes submittedValues on validation failure', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!obj?.email) {
        return { issues: [{ message: 'Email required', path: ['email'] }] };
      }
      return obj;
    });

    const action = createActionClient()
      .schema(schema)
      .action(async ({ input }) => input);

    const result = await action({ name: 'Alice' });
    expect(result.validationErrors).toBeDefined();
    expect(result.submittedValues).toEqual({ name: 'Alice' });
  });

  it('omits submittedValues on success', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      return data as { title: string };
    });

    const action = createActionClient()
      .schema(schema)
      .action(async ({ input }) => input);

    const result = await action({ title: 'Hello' });
    expect(result.data).toBeDefined();
    expect(result).not.toHaveProperty('submittedValues');
  });

  it('includes submittedValues from FormData on validation failure', async () => {
    const schema = mockStandardSchema((_data: unknown) => {
      return { issues: [{ message: 'Invalid', path: ['title'] }] };
    });

    const action = createActionClient()
      .schema(schema)
      .action(async ({ input }) => input);

    const fd = new FormData();
    fd.append('title', '');
    fd.append('category', 'general');
    const result = await action(null, fd);
    expect(result.validationErrors).toBeDefined();
    // Empty string becomes undefined via parseFormData, category preserved
    expect(result.submittedValues).toEqual({ title: undefined, category: 'general' });
  });
});

// ─── useFormErrors ───────────────────────────────────────────────────────

describe('useFormErrors()', () => {
  it('returns empty result for null', () => {
    const errors = useFormErrors(null);
    expect(errors.hasErrors).toBe(false);
    expect(errors.fieldErrors).toEqual({});
    expect(errors.formErrors).toEqual([]);
    expect(errors.serverError).toBeNull();
    expect(errors.getFieldError('title')).toBeNull();
  });

  it('returns empty result for success data', () => {
    const result: ActionResult<string> = { data: 'ok' };
    const errors = useFormErrors(result);
    expect(errors.hasErrors).toBe(false);
  });

  it('extracts field errors from validationErrors', () => {
    const result: ActionResult<never> = {
      validationErrors: {
        title: ['Title is required'],
        email: ['Invalid email', 'Too short'],
      },
    };
    const errors = useFormErrors(result);
    expect(errors.hasErrors).toBe(true);
    expect(errors.fieldErrors).toEqual({
      title: ['Title is required'],
      email: ['Invalid email', 'Too short'],
    });
    expect(errors.getFieldError('title')).toBe('Title is required');
    expect(errors.getFieldError('email')).toBe('Invalid email');
    expect(errors.getFieldError('missing')).toBeNull();
  });

  it('extracts form-level errors from _root key', () => {
    const result: ActionResult<never> = {
      validationErrors: {
        _root: ['Form is invalid', 'Please check all fields'],
        name: ['Required'],
      },
    };
    const errors = useFormErrors(result);
    expect(errors.formErrors).toEqual(['Form is invalid', 'Please check all fields']);
    expect(errors.fieldErrors).toEqual({ name: ['Required'] });
    // _root should NOT appear in fieldErrors
    expect(errors.fieldErrors._root).toBeUndefined();
  });

  it('extracts server errors', () => {
    const result: ActionResult<never> = {
      serverError: { code: 'UNAUTHORIZED' },
    };
    const errors = useFormErrors(result);
    expect(errors.hasErrors).toBe(true);
    expect(errors.serverError).toEqual({ code: 'UNAUTHORIZED' });
  });

  it('works with FormFlashData shape', () => {
    const flash = {
      validationErrors: { name: ['Required'] },
      submittedValues: { name: '' },
    };
    const errors = useFormErrors(flash);
    expect(errors.hasErrors).toBe(true);
    expect(errors.getFieldError('name')).toBe('Required');
  });
});

// ─── Form Flash ──────────────────────────────────────────────────────────

describe('form flash (ALS)', () => {
  it('returns null outside ALS scope', () => {
    expect(getFormFlash()).toBeNull();
  });

  it('returns flash data inside runWithFormFlash scope', () => {
    const flash: FormFlashData = {
      validationErrors: { title: ['Required'] },
      submittedValues: { title: '' },
    };

    let captured: FormFlashData | null = null;
    runWithFormFlash(flash, () => {
      captured = getFormFlash();
    });

    expect(captured).toEqual(flash);
  });

  it('flash data is scoped — not visible after scope exits', () => {
    const flash: FormFlashData = {
      validationErrors: { x: ['err'] },
      submittedValues: {},
    };

    runWithFormFlash(flash, () => {
      expect(getFormFlash()).not.toBeNull();
    });

    expect(getFormFlash()).toBeNull();
  });

  it('supports nested scopes', () => {
    const outer: FormFlashData = {
      validationErrors: { a: ['outer'] },
      submittedValues: {},
    };
    const inner: FormFlashData = {
      validationErrors: { b: ['inner'] },
      submittedValues: {},
    };

    runWithFormFlash(outer, () => {
      expect(getFormFlash()!.validationErrors).toEqual({ a: ['outer'] });

      runWithFormFlash(inner, () => {
        expect(getFormFlash()!.validationErrors).toEqual({ b: ['inner'] });
      });

      expect(getFormFlash()!.validationErrors).toEqual({ a: ['outer'] });
    });
  });
});
