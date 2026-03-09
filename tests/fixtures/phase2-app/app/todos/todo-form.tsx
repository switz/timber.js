'use client';

import { useState } from 'react';

/**
 * Client component form for the todos page.
 *
 * Progressive enhancement:
 * - Without JS: standard form POST + redirect (method="POST")
 * - With JS: inline submission via action, no page reload
 *
 * Test IDs:
 * - todo-form: the <form> element
 * - todo-input: text input for new todo
 * - todo-submit: submit button
 * - validation-error: error message shown when submitting empty
 */
export function TodoForm() {
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const input = form.elements.namedItem('title') as HTMLInputElement;

    if (!input.value.trim()) {
      e.preventDefault();
      setError('Title is required');
      return;
    }

    // With JS enabled, the framework's action client would handle this.
    // For now, let the form submit naturally (no-JS path).
    setError(null);
  }

  return (
    <form
      method="POST"
      action="/todos"
      data-testid="todo-form"
      onSubmit={handleSubmit}
    >
      <input
        type="text"
        name="title"
        data-testid="todo-input"
        placeholder="What needs to be done?"
      />
      <button type="submit" data-testid="todo-submit">
        Add Todo
      </button>
      {error && (
        <p data-testid="validation-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
