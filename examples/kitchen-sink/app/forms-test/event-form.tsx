'use client';

import { useActionState, useFormErrors } from '@timber/app/client';
import { createEvent } from './actions';
import type { FormFlashData } from '@timber/app/server';

const categories = [
  { value: '', label: 'Select a category…' },
  { value: 'conference', label: 'Conference' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'meetup', label: 'Meetup' },
  { value: 'social', label: 'Social' },
];

const tagOptions = ['react', 'typescript', 'rust', 'ai', 'design'];

export function EventForm({ flash }: { flash: FormFlashData | null }) {
  const [result, action, isPending] = useActionState(createEvent, null);
  const errors = useFormErrors(flash ?? result);
  const submitted = flash?.submittedValues ?? result?.submittedValues ?? {};

  return (
    <div className="max-w-lg">
      {/* Success banner */}
      {result?.data && (
        <div
          data-testid="success-message"
          className="mb-4 rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800"
        >
          {result.data.message}
        </div>
      )}

      {/* Form-level errors */}
      {errors.formErrors.length > 0 && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          {errors.formErrors.map((e) => <p key={e}>{e}</p>)}
        </div>
      )}

      <form action={action} className="space-y-5">
        {/* Text input */}
        <Field label="Event Title" error={errors.getFieldError('title')}>
          <input
            name="title"
            data-testid="title-input"
            defaultValue={(submitted.title as string) ?? ''}
            className={inputClass(errors.getFieldError('title'))}
            placeholder="React Summit 2026"
          />
        </Field>

        {/* Textarea */}
        <Field label="Description" error={errors.getFieldError('description')}>
          <textarea
            name="description"
            data-testid="description-input"
            rows={3}
            defaultValue={(submitted.description as string) ?? ''}
            className={inputClass(errors.getFieldError('description'))}
            placeholder="Tell people what this event is about…"
          />
        </Field>

        {/* Date input */}
        <Field label="Date" error={errors.getFieldError('date')}>
          <input
            name="date"
            type="date"
            data-testid="date-input"
            defaultValue={(submitted.date as string) ?? ''}
            className={inputClass(errors.getFieldError('date'))}
          />
        </Field>

        {/* Select */}
        <Field label="Category" error={errors.getFieldError('category')}>
          <select
            name="category"
            data-testid="category-select"
            defaultValue={(submitted.category as string) ?? ''}
            className={inputClass(errors.getFieldError('category'))}
          >
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>

        {/* Number input (coerce.number) */}
        <Field label="Max Attendees" error={errors.getFieldError('maxAttendees')}>
          <input
            name="maxAttendees"
            type="number"
            data-testid="max-attendees-input"
            defaultValue={(submitted.maxAttendees as string) ?? ''}
            className={inputClass(errors.getFieldError('maxAttendees'))}
            placeholder="100"
            min="1"
          />
        </Field>

        {/* Checkbox (coerce.checkbox) */}
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            name="isPublic"
            type="checkbox"
            data-testid="is-public-checkbox"
            defaultChecked={submitted.isPublic === 'on'}
            className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
          />
          Public event
        </label>

        {/* Multi-checkbox (duplicate keys → array) */}
        <fieldset>
          <legend className="text-sm font-medium text-stone-700 mb-2">Tags</legend>
          <div className="flex flex-wrap gap-3">
            {tagOptions.map((tag) => (
              <label key={tag} className="flex items-center gap-1.5 text-sm text-stone-600">
                <input
                  name="tags"
                  type="checkbox"
                  value={tag}
                  defaultChecked={
                    Array.isArray(submitted.tags)
                      ? (submitted.tags as string[]).includes(tag)
                      : false
                  }
                  className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                />
                {tag}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Hidden JSON field (coerce.json) */}
        <input
          type="hidden"
          name="metadata"
          value={JSON.stringify({ source: 'kitchen-sink', version: 1 })}
        />

        <button
          type="submit"
          data-testid="submit-button"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isPending ? 'Creating…' : 'Create Event'}
        </button>
      </form>

      {/* Debug: show result JSON */}
      {result?.data?.event && (
        <details className="mt-6 text-xs">
          <summary className="text-stone-400 cursor-pointer">Response JSON</summary>
          <pre className="mt-2 rounded bg-stone-100 p-3 overflow-x-auto text-stone-600">
            {JSON.stringify(result.data.event, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function inputClass(error: string | null): string {
  const base =
    'block w-full rounded-md shadow-sm text-sm py-2 px-3 border focus:outline-none focus:ring-2 focus:ring-offset-0';
  return error
    ? `${base} border-red-300 text-red-900 focus:border-red-500 focus:ring-red-500`
    : `${base} border-stone-300 text-stone-900 focus:border-amber-500 focus:ring-amber-500`;
}
