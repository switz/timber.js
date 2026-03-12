'use server';

import { validated, coerce } from '@timber/app/server';

// Inline Standard Schema — no external dep needed for the demo
const eventSchema = {
  '~standard': {
    validate(value: unknown) {
      const obj = value as Record<string, unknown>;
      const issues: Array<{ message: string; path: string[] }> = [];

      if (!obj?.title || typeof obj.title !== 'string' || obj.title.trim().length === 0) {
        issues.push({ message: 'Event title is required', path: ['title'] });
      }

      const maxAttendees = coerce.number(obj?.maxAttendees);
      if (maxAttendees !== undefined && maxAttendees < 1) {
        issues.push({ message: 'Must allow at least 1 attendee', path: ['maxAttendees'] });
      }

      if (!obj?.date || typeof obj.date !== 'string') {
        issues.push({ message: 'Date is required', path: ['date'] });
      }

      if (!obj?.category || typeof obj.category !== 'string') {
        issues.push({ message: 'Pick a category', path: ['category'] });
      }

      if (issues.length > 0) return { issues };

      return {
        value: {
          title: (obj.title as string).trim(),
          description: typeof obj.description === 'string' ? obj.description.trim() : '',
          date: obj.date as string,
          category: obj.category as string,
          maxAttendees,
          isPublic: coerce.checkbox(obj?.isPublic),
          tags: Array.isArray(obj?.tags) ? (obj.tags as string[]) : [],
          metadata: coerce.json(obj?.metadata),
        },
      };
    },
  },
};

type EventInput = {
  title: string;
  description: string;
  date: string;
  category: string;
  maxAttendees?: number;
  isPublic: boolean;
  tags: string[];
  metadata: unknown;
};

export const createEvent = validated(eventSchema, async (input: EventInput) => {
  // Simulate a slight delay
  await new Promise((r) => setTimeout(r, 300));

  return {
    message: `Created "${input.title}" on ${input.date}`,
    event: {
      ...input,
      id: Math.random().toString(36).slice(2, 8),
    },
  };
});
