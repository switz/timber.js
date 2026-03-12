'use server';

import { redirect } from '@timber/app/server';

/**
 * Action that redirects to /todos. Tests that with-JS path performs
 * a client-side SPA navigation instead of a full page reload.
 */
export async function redirectToTodos(): Promise<never> {
  redirect('/todos');
}

/**
 * Action that redirects to /action-redirect-test/target.
 * Uses the useActionState contract (prevState, formData) so it can
 * be wired to a <form> for both with-JS and no-JS testing.
 */
export async function redirectFromForm(_prevState: null, _formData: FormData): Promise<never> {
  redirect('/action-redirect-test/target');
}
