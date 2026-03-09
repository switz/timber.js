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

// ─── Types ───────────────────────────────────────────────────────────────

/** Minimal schema interface — compatible with Zod, Valibot, ArkType, etc. */
export interface ActionSchema<T = unknown> {
  parse(data: unknown): T;
  safeParse?(data: unknown): { success: true; data: T } | { success: false; error: SchemaError };
}

/** Schema validation error shape. */
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
  | { data: TData; validationErrors?: never; serverError?: never }
  | { data?: never; validationErrors: ValidationErrors; serverError?: never }
  | {
      data?: never;
      validationErrors?: never;
      serverError: { code: string; data?: Record<string, unknown> };
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

/**
 * Parse FormData into a plain object for schema validation.
 * Handles multi-value fields (multiple values for the same key become arrays).
 */
function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};

  for (const key of new Set(formData.keys())) {
    // Skip React internal fields
    if (key.startsWith('$ACTION_')) continue;

    const values = formData.getAll(key);
    if (values.length === 1) {
      obj[key] = values[0];
    } else {
      obj[key] = values;
    }
  }

  return obj;
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
 * Wrap unexpected errors into a safe server error result.
 * ActionError → typed result. Other errors → INTERNAL_ERROR (no leak).
 */
function handleActionError(error: unknown): ActionResult<never> {
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

        // Validate with schema if provided
        let input: TInput;
        if (schema) {
          if (typeof schema.safeParse === 'function') {
            const result = schema.safeParse(rawInput);
            if (!result.success) {
              return { validationErrors: extractValidationErrors(result.error) };
            }
            input = result.data;
          } else {
            try {
              input = schema.parse(rawInput);
            } catch (parseError) {
              return {
                validationErrors: extractValidationErrors(parseError as SchemaError),
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
