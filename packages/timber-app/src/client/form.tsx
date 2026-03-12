/**
 * Client-side form utilities for server actions.
 *
 * Exports a typed `useActionState` that understands the action builder's result shape.
 * Result is typed to:
 *   { data: T } | { validationErrors: Record<string, string[]> } | { serverError: { code, data? } } | null
 *
 * The action builder emits a function that satisfies both the direct call signature
 * and React's `(prevState, formData) => Promise<State>` contract.
 *
 * See design/08-forms-and-actions.md §"Client-Side Form Mechanics"
 */

import { useActionState as reactUseActionState, useTransition } from 'react';
import type { ActionResult, ValidationErrors } from '../server/action-client';
import type { FormFlashData } from '../server/form-flash';

// ─── Types ───────────────────────────────────────────────────────────────

/**
 * The action function type accepted by useActionState.
 * Must satisfy React's (prevState, formData) => Promise<State> contract.
 */
export type UseActionStateFn<TData> = (
  prevState: ActionResult<TData> | null,
  formData: FormData
) => Promise<ActionResult<TData>>;

/**
 * Return type of useActionState — matches React 19's useActionState return.
 * [result, formAction, isPending]
 */
export type UseActionStateReturn<TData> = [
  result: ActionResult<TData> | null,
  formAction: (formData: FormData) => void,
  isPending: boolean,
];

// ─── useActionState ──────────────────────────────────────────────────────

/**
 * Typed wrapper around React 19's `useActionState` that understands
 * the timber action builder's result shape.
 *
 * @param action - A server action created with createActionClient or a raw 'use server' function.
 * @param initialState - Initial state, typically `null`. Pass `getFormFlash()` for no-JS
 *   progressive enhancement — the flash seeds the initial state so the form has a
 *   single source of truth for both with-JS and no-JS paths.
 * @param permalink - Optional permalink for progressive enhancement (no-JS fallback URL).
 *
 * @example
 * ```tsx
 * 'use client'
 * import { useActionState } from '@timber/app/client'
 * import { createTodo } from './actions'
 *
 * export function NewTodoForm({ flash }) {
 *   const [result, action, isPending] = useActionState(createTodo, flash)
 *   return (
 *     <form action={action}>
 *       <input name="title" />
 *       {result?.validationErrors?.title && <p>{result.validationErrors.title}</p>}
 *       <button disabled={isPending}>Add</button>
 *     </form>
 *   )
 * }
 * ```
 */
export function useActionState<TData>(
  action: UseActionStateFn<TData>,
  initialState: ActionResult<TData> | FormFlashData | null,
  permalink?: string
): UseActionStateReturn<TData> {
  // FormFlashData is structurally compatible with ActionResult at runtime —
  // the cast satisfies React's generic inference which would otherwise widen TData.
  return reactUseActionState(action, initialState as ActionResult<TData> | null, permalink);
}

// ─── useFormAction ───────────────────────────────────────────────────────

/**
 * Hook for calling a server action imperatively (not via a form).
 * Returns [execute, isPending] where execute accepts the input directly.
 *
 * @example
 * ```tsx
 * const [deleteTodo, isPending] = useFormAction(deleteTodoAction)
 * <button onClick={() => deleteTodo({ id: todo.id })} disabled={isPending}>
 *   Delete
 * </button>
 * ```
 */
export function useFormAction<TData>(
  action: (input: unknown) => Promise<ActionResult<TData>>
): [(input?: unknown) => Promise<ActionResult<TData>>, boolean] {
  const [isPending, startTransition] = useTransition();

  const execute = (input?: unknown): Promise<ActionResult<TData>> => {
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await action(input);
        resolve(result);
      });
    });
  };

  return [execute, isPending];
}

// ─── useFormErrors ──────────────────────────────────────────────────────

/** Return type of useFormErrors(). */
export interface FormErrorsResult {
  /** Per-field validation errors keyed by field name. */
  fieldErrors: Record<string, string[]>;
  /** Form-level errors (from `_root` key). */
  formErrors: string[];
  /** Server error if the action threw an ActionError. */
  serverError: { code: string; data?: Record<string, unknown> } | null;
  /** Whether any errors are present. */
  hasErrors: boolean;
  /** Get the first error message for a field, or null. */
  getFieldError: (field: string) => string | null;
}

/**
 * Extract per-field and form-level errors from an ActionResult.
 *
 * Pure function (no internal hooks) — follows React naming convention
 * since it's used in render. Accepts the result from `useActionState`
 * or flash data from `getFormFlash()`.
 *
 * @example
 * ```tsx
 * const [result, action, isPending] = useActionState(createTodo, null)
 * const errors = useFormErrors(result)
 *
 * return (
 *   <form action={action}>
 *     <input name="title" />
 *     {errors.getFieldError('title') && <p>{errors.getFieldError('title')}</p>}
 *     {errors.formErrors.map(e => <p key={e}>{e}</p>)}
 *   </form>
 * )
 * ```
 */
export function useFormErrors<TData>(
  result: ActionResult<TData> | { validationErrors?: ValidationErrors; serverError?: { code: string; data?: Record<string, unknown> } } | null
): FormErrorsResult {
  const empty: FormErrorsResult = {
    fieldErrors: {},
    formErrors: [],
    serverError: null,
    hasErrors: false,
    getFieldError: () => null,
  };

  if (!result) return empty;

  const validationErrors = result.validationErrors as ValidationErrors | undefined;
  const serverError = result.serverError as { code: string; data?: Record<string, unknown> } | undefined;

  if (!validationErrors && !serverError) return empty;

  // Separate _root (form-level) errors from field errors
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];

  if (validationErrors) {
    for (const [key, messages] of Object.entries(validationErrors)) {
      if (key === '_root') {
        formErrors.push(...messages);
      } else {
        fieldErrors[key] = messages;
      }
    }
  }

  const hasErrors = Object.keys(fieldErrors).length > 0 || formErrors.length > 0 || serverError != null;

  return {
    fieldErrors,
    formErrors,
    serverError: serverError ?? null,
    hasErrors,
    getFieldError(field: string): string | null {
      const errs = fieldErrors[field];
      return errs && errs.length > 0 ? errs[0] : null;
    },
  };
}
