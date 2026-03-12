'use client';

import { useActionState } from 'react';
import { redirectFromForm } from './actions';

export function RedirectForm() {
  const [, action, isPending] = useActionState(redirectFromForm, null);

  return (
    <form action={action} data-testid="redirect-form">
      <button type="submit" data-testid="redirect-submit" disabled={isPending}>
        {isPending ? 'Redirecting...' : 'Submit and redirect'}
      </button>
    </form>
  );
}
