/**
 * Tests for the server-action-exports Vite plugin.
 *
 * Verifies that 'use server' modules with non-function-expression exports
 * (like createActionClient().action() or validated()) are rewritten to use
 * `export { name }` syntax, bypassing the RSC plugin's strict AST validation.
 *
 * See: TIM-294, TIM-295
 */
import { describe, test, expect } from 'vitest';
import { timberServerActionExports } from '../packages/timber-app/src/plugins/server-action-exports';

// Extract the transform function from the plugin
function transform(code: string, id: string = 'test.ts') {
  const plugin = timberServerActionExports();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (plugin as any).transform(code, id);
}

describe('server-action-exports', () => {
  test('rewrites export const with CallExpression initializer', () => {
    const input = `'use server';
import { createActionClient } from '@timber/app/server';
const action = createActionClient();
export const createTodo = action.schema(schema).action(async ({ input }) => {
  return input;
});
`;
    const result = transform(input);
    expect(result).toBeDefined();
    expect(result.code).not.toContain('export const createTodo');
    expect(result.code).toContain('const createTodo = action.schema(schema).action(async ({ input }) => {');
    expect(result.code).toContain('export { createTodo }');
  });

  test('rewrites export const with validated() call', () => {
    const input = `'use server';
import { validated } from '@timber/app/server';
export const submitForm = validated(schema, async (input) => {
  return input;
});
`;
    const result = transform(input);
    expect(result).toBeDefined();
    expect(result.code).not.toContain('export const submitForm');
    expect(result.code).toContain('const submitForm = validated(schema, async (input) => {');
    expect(result.code).toContain('export { submitForm }');
  });

  test('leaves async function declarations untouched', () => {
    const input = `'use server';
export async function createTodo(formData) {
  return formData;
}
`;
    const result = transform(input);
    expect(result).toBeUndefined();
  });

  test('leaves async arrow function exports untouched', () => {
    const input = `'use server';
export const createTodo = async () => {
  return 'done';
};
`;
    const result = transform(input);
    expect(result).toBeUndefined();
  });

  test('leaves async function expression exports untouched', () => {
    const input = `'use server';
export const createTodo = async function() {
  return 'done';
};
`;
    const result = transform(input);
    expect(result).toBeUndefined();
  });

  test('rewrites multiple exports in one file', () => {
    const input = `'use server';
import { createActionClient } from '@timber/app/server';
const action = createActionClient();
export const createTodo = action.schema(schema).action(async ({ input }) => input);
export const deleteTodo = action.action(async ({ ctx }) => ctx);
export async function listTodos() { return []; }
`;
    const result = transform(input);
    expect(result).toBeDefined();
    expect(result.code).not.toContain('export const createTodo');
    expect(result.code).not.toContain('export const deleteTodo');
    expect(result.code).toContain('export async function listTodos');
    expect(result.code).toContain('export { deleteTodo, createTodo }');
  });

  test('skips files without use server directive', () => {
    const input = `import { createActionClient } from '@timber/app/server';
export const action = createActionClient();
`;
    const result = transform(input);
    expect(result).toBeUndefined();
  });

  test('skips non-JS/TS files', () => {
    const input = `'use server';
export const foo = bar();
`;
    const result = transform(input, 'test.css');
    expect(result).toBeUndefined();
  });

  test('rewrites export default with CallExpression', () => {
    const input = `'use server';
import { validated } from '@timber/app/server';
export default validated(schema, async (input) => input);
`;
    const result = transform(input);
    expect(result).toBeDefined();
    expect(result.code).toContain('const $$default =');
    expect(result.code).toContain('export default $$default');
  });

  test('leaves export default async function untouched', () => {
    const input = `'use server';
export default async function createTodo() {
  return 'done';
}
`;
    const result = transform(input);
    expect(result).toBeUndefined();
  });

  test('leaves export default identifier untouched', () => {
    const input = `'use server';
const myAction = async () => {};
export default myAction;
`;
    const result = transform(input);
    expect(result).toBeUndefined();
  });

  test('handles mixed exports (const + function + default)', () => {
    const input = `'use server';
import { validated, createActionClient } from '@timber/app/server';
const action = createActionClient();
export const submit = validated(schema, async (input) => input);
export async function reset() { return true; }
export const remove = action.action(async ({ ctx }) => ctx);
`;
    const result = transform(input);
    expect(result).toBeDefined();
    // const exports should be rewritten
    expect(result.code).not.toContain('export const submit');
    expect(result.code).not.toContain('export const remove');
    // function declaration should be preserved
    expect(result.code).toContain('export async function reset');
    // re-exports appended
    expect(result.code).toContain('export { remove, submit }');
  });

  test('handles "use server" with double quotes', () => {
    const input = `"use server";
export const foo = bar();
`;
    const result = transform(input);
    expect(result).toBeDefined();
    expect(result.code).toContain('export { foo }');
  });

  test('preserves non-exported const declarations', () => {
    const input = `'use server';
const action = createActionClient();
export const submit = action.schema(schema).action(async ({ input }) => input);
`;
    const result = transform(input);
    expect(result).toBeDefined();
    expect(result.code).toContain('const action = createActionClient()');
    expect(result.code).toContain('export { submit }');
  });

  test('preserves use server directive in output', () => {
    const input = `'use server';
export const foo = bar();
`;
    const result = transform(input);
    expect(result).toBeDefined();
    expect(result.code).toContain("'use server'");
  });

  test('does not rewrite inline use server in function body', () => {
    const input = `export const foo = async () => {
  'use server';
  return bar();
};
`;
    const result = transform(input);
    expect(result).toBeUndefined();
  });
});
