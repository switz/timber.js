/**
 * createActionClient — typed middleware and schema validation for server actions.
 *
 * Inspired by next-safe-action. Provides a builder API:
 *   createActionClient({ middleware }) → .schema(z.object(...)) → .action(fn)
 *
 * The resulting action function satisfies both:
 *   1. Direct call: action(input) → Promise<ActionResult>
 *   2. React useActionState: (prevState, formData) => Promise<ActionResult>
 *
 * See design/08-forms-and-actions.md §"Middleware for Server Actions"
 */

// ─── ActionError ─────────────────────────────────────────────────────────

/**
 * Typed error class for server actions. Carries a string code and optional data.
 * When thrown from middleware or the action body, the action short-circuits and
 * the client receives `result.serverError`.
 *
 * In production, unexpected errors (non-ActionError) return `{ code: 'INTERNAL_ERROR' }`
 * with no message. In dev, `data.message` is included.
 */
export class ActionError<TCode extends string = string> extends Error {
  readonly code: TCode;
  readonly data: Record<string, unknown> | undefined;

  constructor(code: TCode, data?: Record<string, unknown>) {
    super(`ActionError: ${code}`);
    this.name = 'ActionError';
    this.code = code;
    this.data = data;
  }
}

// ─── Standard Schema ──────────────────────────────────────────────────────

/**
 * Standard Schema v1 interface (subset).
 * Zod ≥3.24, Valibot ≥1.0, and ArkType all implement this.
 * See https://github.com/standard-schema/standard-schema
 *
 * We use permissive types here to accept all compliant libraries without
 * requiring exact structural matches on issues/path shapes.
 */
interface StandardSchemaV1<Output = unknown> {
  '~standard': {
    validate(value: unknown): StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  };
}

type StandardSchemaResult<Output> =
  | { value: Output; issues?: undefined }
  | { value?: undefined; issues: ReadonlyArray<StandardSchemaIssue> };

interface StandardSchemaIssue {
  message: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
}

/** Check if a schema implements the Standard Schema protocol. */
function isStandardSchema(schema: unknown): schema is StandardSchemaV1 {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    '~standard' in schema &&
    typeof (schema as StandardSchemaV1)['~standard'].validate === 'function'
  );
}

// ─── Types ───────────────────────────────────────────────────────────────

/**
 * Minimal schema interface — compatible with Zod, Valibot, ArkType, etc.
 *
 * Accepts either:
 * - Standard Schema (preferred): any object with `~standard.validate()`
 * - Legacy parse interface: objects with `.parse()` / `.safeParse()`
 *
 * At runtime, Standard Schema is detected via `~standard` property and
 * takes priority over the legacy interface.
 */
export type ActionSchema<T = unknown> = StandardSchemaV1<T> | LegacyActionSchema<T>;

/** Legacy schema interface with .parse() / .safeParse(). */
interface LegacyActionSchema<T = unknown> {
  parse(data: unknown): T;
  safeParse?(data: unknown): { success: true; data: T } | { success: false; error: SchemaError };
  // Exclude Standard Schema objects from matching this interface
  '~standard'?: never;
}

/** Schema validation error shape (for legacy .safeParse()/.parse() interface). */
export interface SchemaError {
  issues?: Array<{ path?: Array<string | number>; message: string }>;
  flatten?(): { fieldErrors: Record<string, string[]> };
}

/** Flattened validation errors keyed by field name. */
export type ValidationErrors = Record<string, string[]>;

/** Middleware function: returns context to merge into the action body's ctx. */
export type ActionMiddleware<TCtx = Record<string, unknown>> = () => Promise<TCtx> | TCtx;

/** The result type returned to the client. */
export type ActionResult<TData = unknown> =
  | { data: TData; validationErrors?: never; serverError?: never; submittedValues?: never }
  | {
      data?: never;
      validationErrors: ValidationErrors;
      serverError?: never;
      /** Raw input values on validation failure — for repopulating form fields. */
      submittedValues?: Record<string, unknown>;
    }
  | {
      data?: never;
      validationErrors?: never;
      serverError: { code: string; data?: Record<string, unknown> };
      submittedValues?: never;
    };

/** Context passed to the action body. */
export interface ActionContext<TCtx, TInput> {
  ctx: TCtx;
  input: TInput;
}

// ─── Builder ─────────────────────────────────────────────────────────────

interface ActionClientConfig<TCtx> {
  middleware?: ActionMiddleware<TCtx> | ActionMiddleware<Record<string, unknown>>[];
}

/** Intermediate builder returned by createActionClient(). */
export interface ActionBuilder<TCtx> {
  /** Declare the input schema. Validation errors are returned typed. */
  schema<TInput>(schema: ActionSchema<TInput>): ActionBuilderWithSchema<TCtx, TInput>;
  /** Define the action body without input validation. */
  action<TData>(fn: (ctx: ActionContext<TCtx, undefined>) => Promise<TData>): ActionFn<TData>;
}

/** Builder after .schema() has been called. */
export interface ActionBuilderWithSchema<TCtx, TInput> {
  /** Define the action body with validated input. */
  action<TData>(fn: (ctx: ActionContext<TCtx, TInput>) => Promise<TData>): ActionFn<TData>;
}

/**
 * The final action function. Callable two ways:
 * - Direct: action(input) → Promise<ActionResult<TData>>
 * - React useActionState: action(prevState, formData) → Promise<ActionResult<TData>>
 */
export type ActionFn<TData> = {
  (input?: unknown): Promise<ActionResult<TData>>;
  (prevState: ActionResult<TData> | null, formData: FormData): Promise<ActionResult<TData>>;
};

// ─── Implementation ──────────────────────────────────────────────────────

/**
 * Run middleware array or single function. Returns merged context.
 */
async function runActionMiddleware<TCtx>(
  middleware: ActionMiddleware<TCtx> | ActionMiddleware<Record<string, unknown>>[] | undefined
): Promise<TCtx> {
  if (!middleware) {
    return {} as TCtx;
  }

  if (Array.isArray(middleware)) {
    let merged = {} as Record<string, unknown>;
    for (const mw of middleware) {
      const result = await mw();
      merged = { ...merged, ...result };
    }
    return merged as TCtx;
  }

  return await middleware();
}

// Re-export parseFormData for use throughout the framework
import { parseFormData } from './form-data.js';

/**
 * @deprecated Use parseFormData() from './form-data.js' instead.
 * Kept as internal alias for backward compatibility within action handler.
 */
function formDataToObject(formData: FormData): Record<string, unknown> {
  return parseFormData(formData);
}

/**
 * Extract validation errors from a schema error.
 * Supports Zod's flatten() and generic issues array.
 */
function extractValidationErrors(error: SchemaError): ValidationErrors {
  // Zod-style flatten
  if (typeof error.flatten === 'function') {
    return error.flatten().fieldErrors;
  }

  // Generic issues array
  if (error.issues) {
    const errors: ValidationErrors = {};
    for (const issue of error.issues) {
      const path = issue.path?.join('.') ?? '_root';
      if (!errors[path]) errors[path] = [];
      errors[path].push(issue.message);
    }
    return errors;
  }

  return { _root: ['Validation failed'] };
}

/**
 * Extract validation errors from Standard Schema issues.
 */
function extractStandardSchemaErrors(issues: ReadonlyArray<StandardSchemaIssue>): ValidationErrors {
  const errors: ValidationErrors = {};
  for (const issue of issues) {
    const path = issue.path
      ?.map((p) => {
        // Standard Schema path items can be { key: ... } objects or bare PropertyKey values
        if (typeof p === 'object' && p !== null && 'key' in p) return String(p.key);
        return String(p);
      })
      .join('.') ?? '_root';
    if (!errors[path]) errors[path] = [];
    errors[path].push(issue.message);
  }
  return Object.keys(errors).length > 0 ? errors : { _root: ['Validation failed'] };
}

/**
 * Wrap unexpected errors into a safe server error result.
 * ActionError → typed result. Other errors → INTERNAL_ERROR (no leak).
 *
 * Exported for use by action-handler.ts to catch errors from raw 'use server'
 * functions that don't use createActionClient.
 */
export function handleActionError(error: unknown): ActionResult<never> {
  if (error instanceof ActionError) {
    return {
      serverError: {
        code: error.code,
        ...(error.data ? { data: error.data } : {}),
      },
    };
  }

  // In dev, include the message for debugging
  const isDev = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
  return {
    serverError: {
      code: 'INTERNAL_ERROR',
      ...(isDev && error instanceof Error ? { data: { message: error.message } } : {}),
    },
  };
}

/**
 * Create a typed action client with middleware and schema validation.
 *
 * @example
 * ```ts
 * const action = createActionClient({
 *   middleware: async () => {
 *     const user = await getUser()
 *     if (!user) throw new ActionError('UNAUTHORIZED')
 *     return { user }
 *   },
 * })
 *
 * export const createTodo = action
 *   .schema(z.object({ title: z.string().min(1) }))
 *   .action(async ({ input, ctx }) => {
 *     await db.todos.create({ ...input, userId: ctx.user.id })
 *   })
 * ```
 */
export function createActionClient<TCtx = Record<string, never>>(
  config: ActionClientConfig<TCtx> = {}
): ActionBuilder<TCtx> {
  function buildAction<TInput, TData>(
    schema: ActionSchema<TInput> | undefined,
    fn: (ctx: ActionContext<TCtx, TInput>) => Promise<TData>
  ): ActionFn<TData> {
    async function actionHandler(...args: unknown[]): Promise<ActionResult<TData>> {
      try {
        // Run middleware
        const ctx = await runActionMiddleware(config.middleware);

        // Determine input — either FormData (from useActionState) or direct arg
        let rawInput: unknown;
        if (args.length === 2 && args[1] instanceof FormData) {
          // Called as (prevState, formData) by React useActionState
          rawInput = schema ? formDataToObject(args[1]) : args[1];
        } else {
          // Direct call: action(input)
          rawInput = args[0];
        }

        // Capture submitted values for repopulation on validation failure.
        // Exclude File objects (can't serialize, shouldn't echo back).
        const submittedValues = schema ? stripFiles(rawInput) : undefined;

        // Validate with schema if provided
        let input: TInput;
        if (schema) {
          if (isStandardSchema(schema)) {
            // Standard Schema protocol (Zod ≥3.24, Valibot ≥1.0, ArkType)
            const result = schema['~standard'].validate(rawInput);
            if (result instanceof Promise) {
              throw new Error(
                '[timber] createActionClient: schema returned a Promise — only sync schemas are supported.'
              );
            }
            if (result.issues) {
              return { validationErrors: extractStandardSchemaErrors(result.issues), submittedValues };
            }
            input = result.value;
          } else if (typeof schema.safeParse === 'function') {
            const result = schema.safeParse(rawInput);
            if (!result.success) {
              return { validationErrors: extractValidationErrors(result.error), submittedValues };
            }
            input = result.data;
          } else {
            try {
              input = schema.parse(rawInput);
            } catch (parseError) {
              return {
                validationErrors: extractValidationErrors(parseError as SchemaError),
                submittedValues,
              };
            }
          }
        } else {
          input = rawInput as TInput;
        }

        // Execute the action body
        const data = await fn({ ctx, input });
        return { data };
      } catch (error) {
        return handleActionError(error);
      }
    }

    return actionHandler as ActionFn<TData>;
  }

  return {
    schema<TInput>(schema: ActionSchema<TInput>) {
      return {
        action<TData>(fn: (ctx: ActionContext<TCtx, TInput>) => Promise<TData>): ActionFn<TData> {
          return buildAction(schema, fn);
        },
      };
    },
    action<TData>(fn: (ctx: ActionContext<TCtx, undefined>) => Promise<TData>): ActionFn<TData> {
      return buildAction(undefined, fn as (ctx: ActionContext<TCtx, unknown>) => Promise<TData>);
    },
  };
}

// ─── validated() ────────────────────────────────────────────────────────

/**
 * Convenience wrapper for the common case: validate input, run handler.
 * No middleware needed.
 *
 * @example
 * ```ts
 * 'use server'
 * import { validated } from '@timber/app/server'
 * import { z } from 'zod'
 *
 * export const createTodo = validated(
 *   z.object({ title: z.string().min(1) }),
 *   async (input) => {
 *     await db.todos.create(input)
 *   }
 * )
 * ```
 */
export function validated<TInput, TData>(
  schema: ActionSchema<TInput>,
  handler: (input: TInput) => Promise<TData>
): ActionFn<TData> {
  return createActionClient()
    .schema(schema)
    .action(async ({ input }) => handler(input));
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Strip File objects from a value, returning a plain object safe for
 * serialization. File objects can't be serialized and shouldn't be echoed back.
 */
function stripFiles(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object') return undefined;

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v instanceof File) continue;
    if (Array.isArray(v)) {
      result[k] = v.filter((item) => !(item instanceof File));
    } else if (typeof v === 'object' && v !== null && !(v instanceof File)) {
      result[k] = stripFiles(v) ?? {};
    } else {
      result[k] = v;
    }
  }
  return result;
}
