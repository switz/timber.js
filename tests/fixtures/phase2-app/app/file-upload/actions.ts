'use server';

/**
 * Server actions for the file-upload E2E fixture.
 *
 * Tests file upload through schema validation (Standard Schema pattern).
 * Design doc: design/08-forms-and-actions.md
 */

import { createActionClient } from '@timber/app/server';

// ─── Schema (Standard Schema interface) ──────────────────────────────

/** Standard Schema that accepts a title (string) and an optional avatar (File). */
const uploadSchema = {
  '~standard': {
    validate(value: unknown) {
      const obj = value as Record<string, unknown>;
      const issues: Array<{ message: string; path: Array<string> }> = [];

      if (!obj?.title || typeof obj.title !== 'string' || obj.title.trim().length === 0) {
        issues.push({ message: 'Title is required', path: ['title'] });
      }

      // File is optional — but if present, must be a File instance
      const file = obj?.avatar;
      if (file !== undefined && !(file instanceof File)) {
        issues.push({ message: 'Avatar must be a file', path: ['avatar'] });
      }

      if (issues.length > 0) {
        return { issues };
      }

      return {
        value: {
          title: (obj.title as string).trim(),
          avatar: file as File | undefined,
        },
      };
    },
  },
};

// ─── Action ──────────────────────────────────────────────────────────

type UploadInput = { title: string; avatar?: File };

const action = createActionClient();

export const uploadAction = action.schema(uploadSchema).action(async ({ input }) => {
  const typed = input as UploadInput;

  if (typed.avatar) {
    return {
      message: `Uploaded "${typed.title}" with file ${typed.avatar.name} (${typed.avatar.size} bytes)`,
      fileName: typed.avatar.name,
      fileSize: typed.avatar.size,
    };
  }

  return {
    message: `Saved "${typed.title}" with no file`,
    fileName: null,
    fileSize: 0,
  };
});
