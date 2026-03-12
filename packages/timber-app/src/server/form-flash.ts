/**
 * Form Flash — ALS-based store for no-JS form validation errors.
 *
 * When a no-JS form action returns validation errors, instead of a 302 redirect
 * (which discards errors), the server re-renders the page with flash data
 * injected via AsyncLocalStorage. Server components read the flash to display
 * errors and repopulate form fields.
 *
 * This follows the Remix/Rails pattern — validation failures are not mutations,
 * so PRG isn't needed. Successful actions still redirect (PRG preserved).
 *
 * The flash data is server-side only — never serialized to cookies or headers.
 *
 * See design/08-forms-and-actions.md §"No-JS Error Round-Trip"
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ValidationErrors } from './action-client.js';

// ─── Types ───────────────────────────────────────────────────────────────

/** Flash data injected into the re-render on validation failure. */
export interface FormFlashData {
  /** Validation errors keyed by field name. `_root` for form-level errors. */
  validationErrors: ValidationErrors;
  /** Raw submitted values for repopulating form fields. File objects are excluded. */
  submittedValues: Record<string, unknown>;
  /** Server error if the action threw an ActionError. */
  serverError?: { code: string; data?: Record<string, unknown> };
}

// ─── ALS Store ───────────────────────────────────────────────────────────

const formFlashAls = new AsyncLocalStorage<FormFlashData>();

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Read the form flash data for the current request.
 *
 * Returns `null` if no flash data is present (i.e., this is a normal page
 * render, not a re-render after a validation failure).
 *
 * Call this in server components to detect validation failures and pass
 * error/submitted-value data to client form components:
 *
 * ```tsx
 * // app/contact/page.tsx (server component)
 * import { getFormFlash } from '@timber/app/server'
 *
 * export default function ContactPage() {
 *   const flash = getFormFlash()
 *   return <ContactForm flash={flash} />
 * }
 * ```
 */
export function getFormFlash(): FormFlashData | null {
  return formFlashAls.getStore() ?? null;
}

// ─── Framework-Internal ──────────────────────────────────────────────────

/**
 * Run a callback with form flash data in scope.
 *
 * Used by the action handler to re-render the page with validation errors
 * available via `getFormFlash()`. Not part of the public API.
 *
 * @internal
 */
export function runWithFormFlash<T>(data: FormFlashData, fn: () => T): T {
  return formFlashAls.run(data, fn);
}
