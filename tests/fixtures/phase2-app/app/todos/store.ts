/**
 * In-memory todo store for E2E testing.
 *
 * Scoped by session ID — each test gets its own isolated store via
 * the X-Test-Session header. This prevents cross-test pollution when
 * tests run against a shared dev server.
 */

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

interface SessionStore {
  nextId: number;
  todos: Todo[];
}

const sessions = new Map<string, SessionStore>();

const DEFAULT_SESSION = '__default__';

function getSession(sessionId?: string): SessionStore {
  const key = sessionId || DEFAULT_SESSION;
  let session = sessions.get(key);
  if (!session) {
    session = { nextId: 1, todos: [] };
    sessions.set(key, session);
  }
  return session;
}

export function getTodos(sessionId?: string): Todo[] {
  return [...getSession(sessionId).todos];
}

export function addTodo(title: string, sessionId?: string): Todo {
  const session = getSession(sessionId);
  const todo: Todo = { id: String(session.nextId++), title, completed: false };
  session.todos.push(todo);
  return todo;
}

export function toggleTodo(id: string, sessionId?: string): Todo | null {
  const todo = getSession(sessionId).todos.find((t) => t.id === id);
  if (!todo) return null;
  todo.completed = !todo.completed;
  return todo;
}

export function deleteTodo(id: string, sessionId?: string): boolean {
  const session = getSession(sessionId);
  const idx = session.todos.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  session.todos.splice(idx, 1);
  return true;
}

export function resetTodos(sessionId?: string): void {
  const key = sessionId || DEFAULT_SESSION;
  sessions.delete(key);
}
