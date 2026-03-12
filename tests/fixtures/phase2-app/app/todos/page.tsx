/**
 * Todos page for Phase 2 E2E fixture app.
 * Route: /todos
 *
 * Tests progressive enhancement of forms:
 * - No-JS: form POSTs with method="POST", server responds with 302 redirect
 * - With JS: inline RSC update, no page reload
 * - Validation errors shown inline (JS) or via redirect (no-JS)
 * - CSRF: cross-origin POST rejected with 403
 *
 * Design doc: design/08-forms-and-actions.md
 */
import { getTodos } from './store';
import { headers } from '@timber/app/server';
import { TodoForm } from './todo-form';
import { TodoList } from './todo-list';
import { ResetButton } from './reset-button';

export default function TodosPage() {
  const sessionId = headers().get('x-test-session') ?? undefined;
  const todos = getTodos(sessionId);

  return (
    <div data-testid="todos-content">
      <h1>Todos</h1>
      <TodoList todos={todos} />
      <TodoForm />
      <p data-testid="todo-count">{todos.length} todos</p>
      <ResetButton />
    </div>
  );
}
