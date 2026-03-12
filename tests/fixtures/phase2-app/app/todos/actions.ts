'use server';

/**
 * Server actions for the todos fixture.
 *
 * Uses the X-Test-Session header to scope the store per test session,
 * preventing cross-test pollution in E2E tests.
 *
 * Design doc: design/08-forms-and-actions.md
 */

import { addTodo, deleteTodo, resetTodos } from './store';
import { revalidatePath, headers } from '@timber/app/server';
import { redirect } from '@timber/app/server';

function getSessionId(): string | undefined {
  return headers().get('x-test-session') ?? undefined;
}

/**
 * Add a todo — raw 'use server' function with useActionState contract.
 * Returns { data: ... } on success, { validationErrors: ... } on failure.
 */
export async function addTodoAction(
  _prevState: { data?: string; validationErrors?: Record<string, string[]> } | null,
  formData: FormData
): Promise<{ data?: string; validationErrors?: Record<string, string[]> }> {
  const title = formData.get('title');

  if (!title || typeof title !== 'string' || !title.trim()) {
    return { validationErrors: { title: ['Title is required'] } };
  }

  const todo = addTodo(title.trim(), getSessionId());
  revalidatePath('/todos');
  return { data: todo.id };
}

/**
 * Delete a todo by ID.
 */
export async function deleteTodoAction(
  _prevState: { data?: boolean; validationErrors?: Record<string, string[]> } | null,
  formData: FormData
): Promise<{ data?: boolean; validationErrors?: Record<string, string[]> }> {
  const id = formData.get('id');
  if (!id || typeof id !== 'string') {
    return { validationErrors: { id: ['Missing todo ID'] } };
  }

  deleteTodo(id, getSessionId());
  revalidatePath('/todos');
  return { data: true };
}

/**
 * Action that throws a redirect — tests redirect handling from actions.
 */
export async function redirectAction(): Promise<never> {
  redirect('/todos');
}

/**
 * Reset the todo store — used by E2E tests to clean up between runs.
 */
export async function resetAction(
  _prevState: { data?: boolean } | null,
  _formData: FormData
): Promise<{ data: boolean }> {
  resetTodos(getSessionId());
  revalidatePath('/todos');
  return { data: true };
}
