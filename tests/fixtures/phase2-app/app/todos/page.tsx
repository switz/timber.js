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
import { TodoForm } from './todo-form';

// In a real app, this would read from a database.
// For the fixture, we use a server-side in-memory store.
const todos: string[] = [];

export default function TodosPage() {
  return (
    <div data-testid="todos-content">
      <h1>Todos</h1>

      <ul data-testid="todo-list">
        {todos.map((todo, i) => (
          <li key={i}>{todo}</li>
        ))}
      </ul>

      <TodoForm />
    </div>
  );
}
