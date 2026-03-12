'use client';

import { useActionState } from 'react';
import { deleteTodoAction } from './actions';
import type { Todo } from './store';

type DeleteResult = {
  data?: boolean;
  validationErrors?: Record<string, string[]>;
} | null;

export function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <ul data-testid="todo-list">
      {todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </ul>
  );
}

function TodoItem({ todo }: { todo: Todo }) {
  const [result, formAction, isPending] = useActionState<DeleteResult, FormData>(
    deleteTodoAction,
    null
  );

  return (
    <li data-testid={`todo-${todo.id}`}>
      <span data-testid={`todo-title-${todo.id}`}>{todo.title}</span>
      <form action={formAction} style={{ display: 'inline' }}>
        <input type="hidden" name="id" value={todo.id} />
        <button type="submit" data-testid={`todo-delete-${todo.id}`} disabled={isPending}>
          Delete
        </button>
      </form>
      {result?.validationErrors?.id && (
        <span data-testid="delete-error">{result.validationErrors.id[0]}</span>
      )}
    </li>
  );
}
