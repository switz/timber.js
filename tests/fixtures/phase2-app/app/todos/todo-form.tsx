'use client';

/**
 * Client component form for the todos page.
 *
 * Uses React's useActionState for progressive enhancement:
 * - Without JS: standard form POST + redirect (via permalink)
 * - With JS: inline submission via server action, no page reload
 *
 * Test IDs:
 * - todo-form: the <form> element
 * - todo-input: text input for new todo
 * - todo-submit: submit button
 * - validation-error: error message shown when submitting empty
 * - form-pending: pending indicator during submission
 */
import { useActionState } from 'react';
import { addTodoAction } from './actions';
import { useRef, useEffect } from 'react';

type AddTodoResult = {
  data?: string;
  validationErrors?: Record<string, string[]>;
} | null;

export function TodoForm() {
  const [result, formAction, isPending] = useActionState<AddTodoResult, FormData>(
    addTodoAction,
    null,
    '/todos'
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the input after successful submission
  useEffect(() => {
    if (result?.data && formRef.current) {
      formRef.current.reset();
    }
  }, [result]);

  return (
    <form ref={formRef} action={formAction} data-testid="todo-form">
      <input
        type="text"
        name="title"
        data-testid="todo-input"
        placeholder="What needs to be done?"
      />
      <button type="submit" data-testid="todo-submit" disabled={isPending}>
        Add Todo
      </button>
      {isPending && <span data-testid="form-pending">Saving...</span>}
      {result?.validationErrors?.title && (
        <p data-testid="validation-error" role="alert">
          {result.validationErrors.title[0]}
        </p>
      )}
    </form>
  );
}
