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
import { Parser } from 'acorn';
import acornJsx from 'acorn-jsx';
import { timberServerActionExports } from '../packages/timber-app/src/plugins/server-action-exports';

const jsxParser = Parser.extend(acornJsx());

// Extract the transform function from the plugin
function transform(code: string, id: string = 'test.ts') {
  const plugin = timberServerActionExports();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (plugin as any).transform(code, id);
}

describe('server-action-exports', () => {
  test('rewrites export const with CallExpression initializer', () => {
    const input = `'use server';
import { createActionClient } from '@timber-js/app/server';
const action = createActionClient();
export const createTodo = action.schema(schema).action(async ({ input }) => {
  return input;
});
`;
    const result = transform(input);
    expect(result).toBeDefined();
    expect(result.code).not.toContain('export const createTodo');
    expect(result.code).toContain(
      'const createTodo = action.schema(schema).action(async ({ input }) => {'
    );
    expect(result.code).toContain('export { createTodo }');
  });

  test('rewrites export const with validated() call', () => {
    const input = `'use server';
import { validated } from '@timber-js/app/server';
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
import { createActionClient } from '@timber-js/app/server';
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
    const input = `import { createActionClient } from '@timber-js/app/server';
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
import { validated } from '@timber-js/app/server';
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
import { validated, createActionClient } from '@timber-js/app/server';
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

  // ─── User-land edge cases ──────────────────────────────────────────────

  describe('user-land edge cases', () => {
    test('leaves export { name } re-exports untouched', () => {
      const input = `'use server';
const foo = async () => {};
export { foo };
`;
      const result = transform(input);
      expect(result).toBeUndefined();
    });

    test('leaves export { name } from re-exports untouched', () => {
      const input = `'use server';
export { foo, bar as baz } from './other';
`;
      const result = transform(input);
      expect(result).toBeUndefined();
    });

    test('handles export let (not just const)', () => {
      const input = `'use server';
export let submit = validated(schema, handler);
`;
      const result = transform(input);
      expect(result).toBeDefined();
      expect(result.code).not.toContain('export let');
      expect(result.code).toContain('let submit = validated(schema, handler)');
      expect(result.code).toContain('export { submit }');
    });

    test('handles ternary/conditional initializer', () => {
      const input = `'use server';
export const handler = isAdmin ? adminAction : userAction;
`;
      const result = transform(input);
      expect(result).toBeDefined();
      expect(result.code).toContain('const handler = isAdmin ? adminAction : userAction');
      expect(result.code).toContain('export { handler }');
    });

    test('handles IIFE initializer', () => {
      const input = `'use server';
export const handler = (() => {
  const action = createActionClient();
  return action.action(async () => 'ok');
})();
`;
      const result = transform(input);
      expect(result).toBeDefined();
      expect(result.code).toContain('export { handler }');
    });

    test('does not double-export when user already has export { name }', () => {
      const input = `'use server';
export async function foo() { return 1; }
export { bar } from './other';
`;
      const result = transform(input);
      // No CallExpression exports, nothing to rewrite
      expect(result).toBeUndefined();
    });

    test('preserves existing workaround pattern (_handler + wrapper)', () => {
      const input = `'use server';
const _submit = validated(schema, handler);
export async function submit(...args) {
  return _submit(...args);
}
`;
      const result = transform(input);
      // The workaround uses async function declarations — no rewrite needed
      expect(result).toBeUndefined();
    });

    test('handles file with only async function exports (common pattern)', () => {
      const input = `'use server';
import { revalidatePath } from '@timber-js/app/server';

export async function addTodo(prev, formData) {
  const title = formData.get('title');
  revalidatePath('/todos');
  return { data: title };
}

export async function deleteTodo(prev, formData) {
  const id = formData.get('id');
  revalidatePath('/todos');
  return { data: true };
}
`;
      const result = transform(input);
      expect(result).toBeUndefined();
    });

    test('handles multiline const declaration', () => {
      const input = `'use server';
export const createEvent = action
  .schema(eventSchema)
  .action(async ({ input }) => {
    await db.events.create(input);
    return { success: true };
  });
`;
      const result = transform(input);
      expect(result).toBeDefined();
      expect(result.code).not.toContain('export const createEvent');
      expect(result.code).toContain('export { createEvent }');
      // Verify the multiline body is preserved intact
      expect(result.code).toContain('.schema(eventSchema)');
      expect(result.code).toContain('await db.events.create(input)');
    });

    test('handles mixed call-expression and async arrow in same file', () => {
      const input = `'use server';
export const createTodo = validated(schema, async (input) => input);
export const simpleFn = async () => {
  return 'hello';
};
`;
      const result = transform(input);
      expect(result).toBeDefined();
      // createTodo (CallExpression) should be rewritten
      expect(result.code).not.toContain('export const createTodo');
      expect(result.code).toContain('export { createTodo }');
      // simpleFn (async arrow) should be LEFT as export const
      expect(result.code).toContain('export const simpleFn = async ()');
    });

    test('handles non-async function expression (sync) — still rewrites', () => {
      // Sync function exports are invalid in 'use server' but the RSC plugin
      // should reject them, not our transform. We just rewrite the export form.
      const input = `'use server';
export const handler = function() { return 1; };
`;
      const result = transform(input);
      // sync FunctionExpression is NOT an async function expr, so it gets rewritten
      expect(result).toBeDefined();
      expect(result.code).toContain('export { handler }');
    });

    test('handles string/number literal exports — still rewrites', () => {
      // Invalid in 'use server' but our transform should not crash
      const input = `'use server';
export const name = 'hello';
export const count = 42;
`;
      const result = transform(input);
      expect(result).toBeDefined();
      expect(result.code).toContain('export { count, name }');
    });

    test('preserves comments in the file', () => {
      const input = `'use server';
// This is an action file
import { validated } from '@timber-js/app/server';

/** Create a new todo */
export const createTodo = validated(schema, async (input) => input);

// End of file
`;
      const result = transform(input);
      expect(result).toBeDefined();
      expect(result.code).toContain('// This is an action file');
      expect(result.code).toContain('/** Create a new todo */');
      expect(result.code).toContain('// End of file');
    });

    test('handles export with leading whitespace', () => {
      // Some formatters or codegen might indent exports
      const input = `'use server';
  export const foo = bar();
`;
      const result = transform(input);
      expect(result).toBeDefined();
      expect(result.code).toContain('export { foo }');
      expect(result.code).not.toMatch(/export\s+const\s+foo/);
    });

    test('handles semicolonless style', () => {
      const input = `'use server'
export const submit = validated(schema, async (input) => input)
export async function reset() { return true }
`;
      const result = transform(input);
      expect(result).toBeDefined();
      expect(result.code).toContain('export { submit }');
      expect(result.code).toContain('export async function reset');
    });

    test('handles file with imports and non-exported helpers', () => {
      const input = `'use server';
import { createActionClient } from '@timber-js/app/server';
import { db } from '../lib/db';

const action = createActionClient({
  middleware: async () => {
    const user = await getUser();
    return { user };
  },
});

function getUser() {
  return { id: '1', name: 'test' };
}

export const createTodo = action
  .schema(todoSchema)
  .action(async ({ input, ctx }) => {
    await db.todos.create({ ...input, userId: ctx.user.id });
    return { success: true };
  });
`;
      const result = transform(input);
      expect(result).toBeDefined();
      // Private helpers and imports preserved
      expect(result.code).toContain("import { createActionClient } from '@timber-js/app/server'");
      expect(result.code).toContain("import { db } from '../lib/db'");
      expect(result.code).toContain('const action = createActionClient(');
      expect(result.code).toContain('function getUser()');
      // Export rewritten
      expect(result.code).not.toContain('export const createTodo');
      expect(result.code).toContain('export { createTodo }');
    });

    test('handles export with await initializer (top-level await)', () => {
      const input = `'use server';
export const handler = await createHandler();
`;
      const result = transform(input);
      expect(result).toBeDefined();
      expect(result.code).toContain('const handler = await createHandler()');
      expect(result.code).toContain('export { handler }');
    });

    test('handles export default with new expression', () => {
      // Unusual but possible
      const input = `'use server';
export default new ActionHandler();
`;
      const result = transform(input);
      expect(result).toBeDefined();
      expect(result.code).toContain('const $$default = new ActionHandler()');
      expect(result.code).toContain('export default $$default');
    });

    test('output is valid JS that can be re-parsed', () => {
      const input = `'use server';
import { createActionClient, validated } from '@timber-js/app/server';

const action = createActionClient();

export const create = action.schema(schema).action(async ({ input }) => input);
export const update = validated(schema, async (input) => input);
export async function remove(id) { return id; }
`;
      const result = transform(input);
      expect(result).toBeDefined();
      // Verify the output can be parsed again without errors
      expect(() => {
        jsxParser.parse(result.code, {
          ecmaVersion: 'latest',
          sourceType: 'module',
        });
      }).not.toThrow();
    });
  });
});
