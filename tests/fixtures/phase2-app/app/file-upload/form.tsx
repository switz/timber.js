'use client';

/**
 * Client component form for file upload E2E fixture.
 *
 * Demonstrates file upload through schema-validated server actions.
 * Works both with JS (inline RSC update) and without JS (flash-based).
 */

import { useActionState, useFormErrors } from '@timber/app/client';
import { uploadAction } from './actions';
import type { FormFlashData } from '@timber/app/server';

interface UploadFormProps {
  flash: FormFlashData | null;
}

export function UploadForm({ flash }: UploadFormProps) {
  const [result, action, isPending] = useActionState(uploadAction, flash);
  const errors = useFormErrors(result);

  return (
    <form action={action} encType="multipart/form-data" data-testid="upload-form">
      {errors.serverError && <div data-testid="server-error">Error: {errors.serverError.code}</div>}

      {result?.data && (
        <div data-testid="success-message">{(result.data as { message: string }).message}</div>
      )}

      <label>
        Title
        <input name="title" data-testid="title-input" />
      </label>
      {errors.getFieldError('title') && (
        <p data-testid="title-error" className="field-error">
          {errors.getFieldError('title')}
        </p>
      )}

      <label>
        Avatar
        <input name="avatar" type="file" data-testid="avatar-input" />
      </label>
      {errors.getFieldError('avatar') && (
        <p data-testid="avatar-error" className="field-error">
          {errors.getFieldError('avatar')}
        </p>
      )}

      <button type="submit" data-testid="upload-submit" disabled={isPending}>
        {isPending ? 'Uploading...' : 'Upload'}
      </button>
    </form>
  );
}
