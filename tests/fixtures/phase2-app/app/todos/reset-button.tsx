'use client';

import { useActionState } from 'react';
import { resetAction } from './actions';

type ResetResult = { data?: boolean } | null;

/**
 * Hidden button to reset the todo store from E2E tests.
 * Calls the resetAction server action when clicked.
 */
export function ResetButton() {
  const [, formAction] = useActionState<ResetResult, FormData>(resetAction, null);

  return (
    <form action={formAction}>
      <button
        type="submit"
        data-testid="todo-reset"
        style={{ position: 'absolute', left: '-9999px' }}
      >
        Reset
      </button>
    </form>
  );
}
