import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod/v4';
import * as v from 'valibot';
import { createActionClient } from '../packages/timber-app/src/server/action-client';
import type { ActionResult } from '../packages/timber-app/src/server/action-client';
import { createSearchParams, fromSchema } from '@timber/app/search-params';
import type { SearchParamCodec } from '@timber/app/search-params';

// ---------------------------------------------------------------------------
// Action client — Standard Schema (Zod v4)
// ---------------------------------------------------------------------------

describe('createActionClient with Zod v4 (Standard Schema)', () => {
  const todoSchema = z.object({
    title: z.string().min(1),
  });

  it('validates and passes valid input', async () => {
    const client = createActionClient();
    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      return { title: input.title };
    });

    const result = await createTodo({ title: 'Buy groceries' });
    expect(result).toEqual({ data: { title: 'Buy groceries' } });
  });

  it('returns validation errors for invalid input', async () => {
    const client = createActionClient();
    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      return { title: input.title };
    });

    const result = await createTodo({ title: '' });
    expect(result.validationErrors).toBeDefined();
    expect(result.data).toBeUndefined();
  });

  it('action body never runs on validation failure', async () => {
    const spy = vi.fn();
    const client = createActionClient();
    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      spy();
      return input;
    });

    await createTodo({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('works with middleware + schema together', async () => {
    const client = createActionClient({
      middleware: async () => ({ user: { id: '1' } }),
    });

    const createTodo = client
      .schema(z.object({ title: z.string().min(1) }))
      .action(async ({ input, ctx }) => {
        return { title: input.title, userId: ctx.user.id };
      });

    const result = await createTodo({ title: 'Test' });
    expect(result).toEqual({ data: { title: 'Test', userId: '1' } });
  });

  it('handles FormData with Zod schema', async () => {
    const client = createActionClient();
    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      return { title: input.title };
    });

    const formData = new FormData();
    formData.set('title', 'From form');

    const result = await (
      createTodo as (prev: unknown, fd: FormData) => Promise<ActionResult<unknown>>
    )(null, formData);
    expect(result).toEqual({ data: { title: 'From form' } });
  });
});

// ---------------------------------------------------------------------------
// Action client — Standard Schema (Valibot)
// ---------------------------------------------------------------------------

describe('createActionClient with Valibot (Standard Schema)', () => {
  const todoSchema = v.object({
    title: v.pipe(v.string(), v.minLength(1)),
  });

  it('validates and passes valid input', async () => {
    const client = createActionClient();
    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      return { title: input.title };
    });

    const result = await createTodo({ title: 'Buy groceries' });
    expect(result).toEqual({ data: { title: 'Buy groceries' } });
  });

  it('returns validation errors for invalid input', async () => {
    const client = createActionClient();
    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      return { title: input.title };
    });

    const result = await createTodo({ title: '' });
    expect(result.validationErrors).toBeDefined();
    expect(result.data).toBeUndefined();
  });

  it('returns field-level errors', async () => {
    const client = createActionClient();
    const schema = v.object({
      title: v.pipe(v.string(), v.minLength(1)),
      count: v.pipe(v.number(), v.minValue(0)),
    });

    const action = client.schema(schema).action(async ({ input }) => input);

    // Both fields invalid
    const result = await action({ title: '', count: -1 });
    expect(result.validationErrors).toBeDefined();
  });

  it('action body never runs on validation failure', async () => {
    const spy = vi.fn();
    const client = createActionClient();
    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      spy();
      return input;
    });

    await createTodo({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('works with middleware + schema together', async () => {
    const client = createActionClient({
      middleware: async () => ({ user: { id: '1' } }),
    });

    const createTodo = client
      .schema(v.object({ title: v.pipe(v.string(), v.minLength(1)) }))
      .action(async ({ input, ctx }) => {
        return { title: input.title, userId: ctx.user.id };
      });

    const result = await createTodo({ title: 'Test' });
    expect(result).toEqual({ data: { title: 'Test', userId: '1' } });
  });

  it('handles FormData with Valibot schema', async () => {
    const client = createActionClient();
    const createTodo = client.schema(todoSchema).action(async ({ input }) => {
      return { title: input.title };
    });

    const formData = new FormData();
    formData.set('title', 'From form');

    const result = await (
      createTodo as (prev: unknown, fd: FormData) => Promise<ActionResult<unknown>>
    )(null, formData);
    expect(result).toEqual({ data: { title: 'From form' } });
  });
});

// ---------------------------------------------------------------------------
// Action client — legacy .parse()/.safeParse() interface (backward compat)
// ---------------------------------------------------------------------------

describe('createActionClient with legacy parse interface', () => {
  function legacySchema<T>(validator: (data: unknown) => T) {
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

  it('still works with legacy parse/safeParse schemas', async () => {
    const schema = legacySchema((data: unknown) => {
      const obj = data as Record<string, unknown>;
      if (!obj || typeof obj.title !== 'string' || obj.title.length < 1) {
        throw new Error('Title is required');
      }
      return { title: obj.title };
    });

    const client = createActionClient();
    const createTodo = client.schema(schema).action(async ({ input }) => {
      return { title: input.title };
    });

    const good = await createTodo({ title: 'Works' });
    expect(good).toEqual({ data: { title: 'Works' } });

    const bad = await createTodo({ title: '' });
    expect(bad.validationErrors).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Search params — fromSchema with Zod v4
// ---------------------------------------------------------------------------

describe('fromSchema with Zod v4', () => {
  it('parses number from string', () => {
    const codec = fromSchema(z.coerce.number().int().min(1).default(1));
    expect(codec.parse('5')).toBe(5);
    expect(codec.parse(undefined)).toBe(1); // default
    expect(codec.parse('invalid')).toBe(1); // fallback to default
  });

  it('serializes number to string', () => {
    const codec = fromSchema(z.coerce.number().int().min(1).default(1));
    expect(codec.serialize(5)).toBe('5');
    expect(codec.serialize(null as unknown as number)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Search params — fromSchema with Valibot
// ---------------------------------------------------------------------------

describe('fromSchema with Valibot', () => {
  it('parses number from string', () => {
    const schema = v.pipe(
      v.unknown(),
      v.transform((val) => {
        if (val === undefined || val === null || val === '') return 1;
        const num = Number(val);
        return Number.isNaN(num) ? 1 : num;
      }),
      v.number(),
      v.integer(),
      v.minValue(1)
    );
    const codec = fromSchema(schema);
    expect(codec.parse('5')).toBe(5);
    expect(codec.parse(undefined)).toBe(1);
  });

  it('works in createSearchParams composition', () => {
    const schema = v.pipe(
      v.unknown(),
      v.transform((val) => {
        if (val === undefined || val === null || val === '') return null;
        return String(val);
      }),
      v.nullable(v.string())
    );

    const params = createSearchParams({
      q: fromSchema(schema),
    });

    const parsed = params.parse(new URLSearchParams('q=hello'));
    expect(parsed.q).toBe('hello');

    const empty = params.parse(new URLSearchParams(''));
    expect(empty.q).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Custom date codec (userland pattern — not a framework built-in)
// ---------------------------------------------------------------------------

describe('custom date codec pattern', () => {
  // Users build date codecs as custom SearchParamCodec implementations
  const parseAsDate: SearchParamCodec<Date | null> = {
    parse(value: string | string[] | undefined): Date | null {
      if (value === undefined || value === null) return null;
      const str = Array.isArray(value) ? value[value.length - 1] : value;
      if (!str) return null;
      const date = new Date(str);
      if (Number.isNaN(date.getTime())) return null;
      return date;
    },
    serialize(value: Date | null): string | null {
      if (value === null || value === undefined) return null;
      if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
      return value.toISOString();
    },
  };

  it('parses ISO 8601 string to Date', () => {
    const date = parseAsDate.parse('2026-03-12T00:00:00.000Z');
    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe('2026-03-12T00:00:00.000Z');
  });

  it('returns null for undefined/empty', () => {
    expect(parseAsDate.parse(undefined)).toBeNull();
    expect(parseAsDate.parse('')).toBeNull();
  });

  it('round-trips through createSearchParams', () => {
    const params = createSearchParams({
      from: parseAsDate,
      to: parseAsDate,
    });

    const date1 = new Date('2026-03-01T00:00:00.000Z');
    const date2 = new Date('2026-03-31T00:00:00.000Z');

    const qs = params.serialize({ from: date1, to: date2 });
    expect(qs).toContain('from=');
    expect(qs).toContain('to=');

    const parsed = params.parse(new URLSearchParams(qs));
    expect(parsed.from!.toISOString()).toBe(date1.toISOString());
    expect(parsed.to!.toISOString()).toBe(date2.toISOString());
  });

  it('omits null values in serialization', () => {
    const params = createSearchParams({
      from: parseAsDate,
    });

    const qs = params.serialize({ from: null });
    expect(qs).toBe('');
  });

  it('date codec works with Zod via fromSchema', () => {
    // Zod-based date coercion
    const codec = fromSchema(z.coerce.date().nullable().default(null));

    const date = codec.parse('2026-03-12');
    expect(date).toBeInstanceOf(Date);

    expect(codec.parse(undefined)).toBeNull();
  });
});
