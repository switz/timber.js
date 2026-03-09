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
import type { ActionResult } from '../server/action-client';

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
 * @param initialState - Initial state, typically `null`.
 * @param permalink - Optional permalink for progressive enhancement (no-JS fallback URL).
 *
 * @example
 * ```tsx
 * 'use client'
 * import { useActionState } from '@timber/app/client'
 * import { createTodo } from './actions'
 *
 * export function NewTodoForm() {
 *   const [result, action, isPending] = useActionState(createTodo, null)
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
  initialState: ActionResult<TData> | null,
  permalink?: string
): UseActionStateReturn<TData> {
  return reactUseActionState(action, initialState, permalink);
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
