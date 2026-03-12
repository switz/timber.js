'use client';

/**
 * Client component form for the validated-form fixture.
 *
 * Demonstrates useActionState + useFormErrors + submittedValues repopulation.
 * Works both with JS (inline errors) and without JS (flash-based errors).
 */

import { useActionState, useFormErrors } from '@timber/app/client';
import { submitContact } from './actions';
import type { FormFlashData } from '@timber/app/server';

interface ContactFormProps {
  flash: FormFlashData | null;
}

export function ContactForm({ flash }: ContactFormProps) {
  // Flash seeds the initial state for no-JS submissions.
  // With JS, React manages state updates via useActionState.
  // Either way, `result` is the single source of truth.
  const [result, action, isPending] = useActionState(submitContact, flash);
  const errors = useFormErrors(result);
  const submitted = result?.submittedValues ?? {};

  return (
    <form action={action} data-testid="contact-form">
      {/* Form-level errors */}
      {errors.formErrors.length > 0 && (
        <div data-testid="form-errors">
          {errors.formErrors.map((e) => (
            <p key={e} className="error">
              {e}
            </p>
          ))}
        </div>
      )}

      {/* Server errors */}
      {errors.serverError && (
        <div data-testid="server-error">
          Error: {errors.serverError.code}
        </div>
      )}

      {/* Success message */}
      {result?.data && (
        <div data-testid="success-message">{result.data.message}</div>
      )}

      <label>
        Name
        <input
          name="name"
          data-testid="name-input"
          defaultValue={(submitted.name as string) ?? ''}
        />
      </label>
      {errors.getFieldError('name') && (
        <p data-testid="name-error" className="field-error">
          {errors.getFieldError('name')}
        </p>
      )}

      <label>
        Email
        <input
          name="email"
          type="email"
          data-testid="email-input"
          defaultValue={(submitted.email as string) ?? ''}
        />
      </label>
      {errors.getFieldError('email') && (
        <p data-testid="email-error" className="field-error">
          {errors.getFieldError('email')}
        </p>
      )}

      <label>
        Age
        <input
          name="age"
          type="number"
          data-testid="age-input"
          defaultValue={(submitted.age as string) ?? ''}
        />
      </label>
      {errors.getFieldError('age') && (
        <p data-testid="age-error" className="field-error">
          {errors.getFieldError('age')}
        </p>
      )}

      <label>
        <input
          name="subscribe"
          type="checkbox"
          data-testid="subscribe-input"
          defaultChecked={submitted.subscribe === 'on'}
        />
        Subscribe to newsletter
      </label>

      <button type="submit" data-testid="submit-button" disabled={isPending}>
        {isPending ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}
