'use server';

/**
 * Server actions for the validated-form fixture.
 *
 * Tests `validated()`, `coerce`, and `parseFormData` with both Zod and
 * Standard Schema patterns.
 *
 * Design doc: design/08-forms-and-actions.md
 */

import { validated, createActionClient } from '@timber/app/server';
import { coerce } from '@timber/app/server';

// ─── Schema (Standard Schema interface, no external dep) ────────────────

/** Minimal Standard Schema implementation for testing — no Zod/Valibot dep needed. */
const contactSchema = {
  '~standard': {
    validate(value: unknown) {
      const obj = value as Record<string, unknown>;
      const issues: Array<{ message: string; path: Array<string> }> = [];

      if (!obj?.name || typeof obj.name !== 'string' || obj.name.trim().length === 0) {
        issues.push({ message: 'Name is required', path: ['name'] });
      }
      if (!obj?.email || typeof obj.email !== 'string' || !obj.email.includes('@')) {
        issues.push({ message: 'Valid email is required', path: ['email'] });
      }

      const age = coerce.number(obj?.age);
      if (age !== undefined && age < 0) {
        issues.push({ message: 'Age must be non-negative', path: ['age'] });
      }

      if (issues.length > 0) {
        return { issues };
      }

      return {
        value: {
          name: (obj.name as string).trim(),
          email: (obj.email as string).trim(),
          age,
          subscribe: coerce.checkbox(obj?.subscribe),
        },
      };
    },
  },
};

// ─── Actions ─────────────────────────────────────────────────────────────

type ContactInput = { name: string; email: string; age?: number; subscribe: boolean };

const _submitContact = validated(contactSchema, async (input: ContactInput) => {
  // In a real app, this would save to a database
  return {
    message: `Thanks ${input.name}! We'll email ${input.email}.`,
    age: input.age,
    subscribe: input.subscribe,
  };
});

export async function submitContact(...args: Parameters<typeof _submitContact>) {
  return _submitContact(...args);
}

// ─── Action with createActionClient for richer testing ───────────────────

const action = createActionClient();

const _submitWithClient = action
  .schema(contactSchema)
  .action(async ({ input }) => {
    const typed = input as ContactInput;
    return {
      message: `Saved ${typed.name}`,
      subscribe: typed.subscribe,
    };
  });

export async function submitWithClient(...args: Parameters<typeof _submitWithClient>) {
  return _submitWithClient(...args);
}
