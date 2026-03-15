'use server';

import { createActionClient } from '@timber/app/server';
import { z } from 'zod/v4';

const action = createActionClient();

export const subscribe = action
  .schema(
    z.object({
      email: z.string().email(),
    })
  )
  .action(async ({ input }) => {
    // In production: add to mailing list
    console.log('Newsletter signup:', input.email);
    return { success: true as const };
  });
