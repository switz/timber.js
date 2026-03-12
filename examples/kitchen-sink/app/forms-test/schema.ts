import * as v from 'valibot';
import { coerce } from '@timber/app/server';

export const eventSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1, 'Event title is required')),
  description: v.optional(v.pipe(v.string(), v.trim()), ''),
  date: v.pipe(v.string(), v.minLength(1, 'Date is required')),
  category: v.pipe(v.string(), v.minLength(1, 'Pick a category')),
  maxAttendees: v.pipe(
    v.unknown(),
    v.transform(coerce.number),
    v.optional(v.pipe(v.number(), v.minValue(1, 'Must allow at least 1 attendee')))
  ),
  isPublic: v.pipe(v.unknown(), v.transform(coerce.checkbox)),
  tags: v.optional(v.array(v.string()), []),
  metadata: v.pipe(v.unknown(), v.transform(coerce.json)),
});

export type EventInput = v.InferOutput<typeof eventSchema>;
