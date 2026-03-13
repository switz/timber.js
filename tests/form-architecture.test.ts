import { describe, it, expect } from 'vitest';
import { createActionClient, validated } from '../packages/timber-app/src/server/action-client';
import type { ActionResult } from '../packages/timber-app/src/server/action-client';
import { useFormErrors } from '../packages/timber-app/src/client/form';
import { getFormFlash, runWithFormFlash } from '../packages/timber-app/src/server/form-flash';
import type { FormFlashData } from '../packages/timber-app/src/server/form-flash';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Minimal Standard Schema implementation for testing. */
function mockStandardSchema<T>(
  validator: (
    data: unknown
  ) => T | { issues: Array<{ message: string; path?: Array<string | { key: string }> }> }
) {
  return {
    '~standard': {
      validate(value: unknown) {
        const result = validator(value);
        if (result && typeof result === 'object' && 'issues' in result) {
          return result as {
            issues: Array<{ message: string; path?: Array<string | { key: string }> }>;
          };
        }
        return { value: result as T };
      },
    },
  };
}

/** Minimal legacy schema (Zod-like) for testing. */
function mockLegacySchema<T>(validator: (data: unknown) => T) {
  return {
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

// ─── File Upload Through Schema Validation ──────────────────────────

describe('file upload through schema validation', () => {
  it('File objects pass through Standard Schema validation', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!obj?.title || typeof obj.title !== 'string') {
        return { issues: [{ message: 'Title is required', path: ['title'] }] };
      }
      if (!(obj.file instanceof File)) {
        return { issues: [{ message: 'File is required', path: ['file'] }] };
      }
      return { title: obj.title, file: obj.file as File };
    });

    const action = createActionClient()
      .schema(schema)
      .action(async ({ input }) => {
        const typed = input as { title: string; file: File };
        return { name: typed.file.name, size: typed.file.size };
      });

    // Direct call with File object
    const file = new File(['hello world'], 'test.txt', { type: 'text/plain' });
    const result = await action({ title: 'Upload', file });
    expect(result.data).toEqual({ name: 'test.txt', size: 11 });
  });

  it('File objects from FormData pass through Standard Schema validation', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!(obj?.avatar instanceof File)) {
        return { issues: [{ message: 'Avatar is required', path: ['avatar'] }] };
      }
      return { avatar: obj.avatar as File };
    });

    const action = createActionClient()
      .schema(schema)
      .action(async ({ input }) => {
        const typed = input as { avatar: File };
        return { name: typed.avatar.name, size: typed.avatar.size };
      });

    const fd = new FormData();
    fd.append('avatar', new File(['image-data'], 'photo.jpg', { type: 'image/jpeg' }));
    const result = await (
      action as (prev: unknown, fd: FormData) => Promise<ActionResult<unknown>>
    )(null, fd);
    expect(result.data).toEqual({ name: 'photo.jpg', size: 10 });
  });

  it('File objects pass through legacy schema validation', async () => {
    const schema = mockLegacySchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!(obj?.file instanceof File)) {
        throw new Error('File is required');
      }
      return { file: obj.file as File };
    });

    const action = createActionClient()
      .schema(schema)
      .action(async ({ input }) => {
        const typed = input as { file: File };
        return { name: typed.file.name };
      });

    const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
    const result = await action({ file });
    expect(result.data).toEqual({ name: 'doc.pdf' });
  });

  it('schema rejection works for missing File fields', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!(obj?.file instanceof File)) {
        return { issues: [{ message: 'File is required', path: ['file'] }] };
      }
      return { file: obj.file as File };
    });

    const action = createActionClient()
      .schema(schema)
      .action(async ({ input }) => input);

    // Submit without file
    const result = await action({ title: 'no file' });
    expect(result.validationErrors).toBeDefined();
    expect(result.validationErrors!.file).toContain('File is required');
  });

  it('File objects stripped from submittedValues on validation failure', async () => {
    const schema = mockStandardSchema((_data: unknown) => {
      return { issues: [{ message: 'Invalid', path: ['title'] }] };
    });

    const action = createActionClient()
      .schema(schema)
      .action(async ({ input }) => input);

    const file = new File(['data'], 'secret.txt');
    const result = await action({ title: 'x', file });
    expect(result.validationErrors).toBeDefined();
    // File should be stripped from submittedValues
    expect(result.submittedValues).toBeDefined();
    expect(result.submittedValues!.file).toBeUndefined();
    expect(result.submittedValues!.title).toBe('x');
  });

  it('empty File inputs from FormData become undefined (not validated as File)', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      // Avatar is optional — undefined is fine
      return { title: obj?.title as string, avatar: obj?.avatar };
    });

    const action = createActionClient()
      .schema(schema)
      .action(async ({ input }) => {
        const typed = input as { title: string; avatar?: File };
        return { hasAvatar: typed.avatar instanceof File };
      });

    const fd = new FormData();
    fd.append('title', 'Test');
    // Empty file input — browsers send File with name="" and size=0
    fd.append('avatar', new File([], ''));
    const result = await (
      action as (prev: unknown, fd: FormData) => Promise<ActionResult<unknown>>
    )(null, fd);
    expect(result.data).toEqual({ hasAvatar: false });
  });

  it('multiple file uploads in FormData pass through validation', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!Array.isArray(obj?.files)) {
        return { issues: [{ message: 'Files required', path: ['files'] }] };
      }
      return { files: obj.files as File[] };
    });

    const action = createActionClient()
      .schema(schema)
      .action(async ({ input }) => {
        const typed = input as { files: File[] };
        return { count: typed.files.length, names: typed.files.map((f) => f.name) };
      });

    const fd = new FormData();
    fd.append('files', new File(['a'], 'a.txt'));
    fd.append('files', new File(['b'], 'b.txt'));
    fd.append('files', new File(['c'], 'c.txt'));
    const result = await (
      action as (prev: unknown, fd: FormData) => Promise<ActionResult<unknown>>
    )(null, fd);
    expect(result.data).toEqual({ count: 3, names: ['a.txt', 'b.txt', 'c.txt'] });
  });
});

// ─── File Size Validation ────────────────────────────────────────────

describe('file size validation in action client', () => {
  it('rejects files exceeding configured size limit', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      return { file: obj?.file as File };
    });

    const action = createActionClient({
      fileSizeLimit: 100, // 100 bytes
    })
      .schema(schema)
      .action(async ({ input }) => {
        const typed = input as { file: File };
        return { name: typed.file.name };
      });

    // File exceeding limit
    const bigFile = new File([new ArrayBuffer(200)], 'big.bin');
    const result = await action({ file: bigFile });
    expect(result.validationErrors).toBeDefined();
    expect(result.validationErrors!.file).toBeDefined();
    expect(result.validationErrors!.file[0]).toMatch(/exceeds.*limit/i);
  });

  it('allows files within size limit', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      return { file: obj?.file as File };
    });

    const action = createActionClient({
      fileSizeLimit: 1000,
    })
      .schema(schema)
      .action(async ({ input }) => {
        const typed = input as { file: File };
        return { name: typed.file.name };
      });

    const smallFile = new File(['hello'], 'small.txt');
    const result = await action({ file: smallFile });
    expect(result.data).toEqual({ name: 'small.txt' });
  });

  it('validates multiple files individually', async () => {
    const schema = mockStandardSchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      return { files: obj?.files as File[] };
    });

    const action = createActionClient({
      fileSizeLimit: 100,
    })
      .schema(schema)
      .action(async ({ input }) => input);

    const fd = new FormData();
    fd.append('files', new File(['small'], 'ok.txt'));
    fd.append('files', new File([new ArrayBuffer(200)], 'toobig.bin'));
    const result = await (
      action as (prev: unknown, fd: FormData) => Promise<ActionResult<unknown>>
    )(null, fd);
    expect(result.validationErrors).toBeDefined();
    expect(result.validationErrors!.files).toBeDefined();
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

  it('supports success flash data (data field)', () => {
    const flash: FormFlashData = {
      data: { message: 'Created successfully', id: '123' },
    };

    let captured: FormFlashData | null = null;
    runWithFormFlash(flash, () => {
      captured = getFormFlash();
    });

    expect(captured).toEqual(flash);
    expect(captured!.data).toEqual({ message: 'Created successfully', id: '123' });
    expect(captured!.validationErrors).toBeUndefined();
  });
});
