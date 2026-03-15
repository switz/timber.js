'use server';

import { createActionClient } from '@timber/app/server';
import { z } from 'zod/v4';

const action = createActionClient();

export const submitContact = action
  .schema(
    z.object({
      email: z.string().email(),
      message: z.string().min(10, 'Message must be at least 10 characters').max(1000),
    })
  )
  .action(async ({ input }) => {
    // In production: send email, store in DB, etc.
    console.log('Contact form submission:', input);
    return { success: true as const };
  });
