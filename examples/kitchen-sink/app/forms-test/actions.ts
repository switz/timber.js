'use server';

import { createActionClient, deny } from '@timber/app/server';
import { eventSchema } from './schema';

const action = createActionClient();

const _createEvent = action.schema(eventSchema).action(async ({ input }) => {
  if (!input) deny(500);
  await new Promise((r) => setTimeout(r, 300));

  return {
    message: `Created "${input.title}" on ${input.date}`,
    event: {
      ...input,
      id: Math.random().toString(36).slice(2, 8),
    },
  };
});

export async function createEvent(...args: Parameters<typeof _createEvent>) {
  return _createEvent(...args);
}
