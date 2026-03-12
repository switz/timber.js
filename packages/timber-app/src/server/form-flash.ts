/**
 * Form Flash — ALS-based store for no-JS form action results.
 *
 * When a no-JS form action completes, the server re-renders the page with
 * the action result injected via AsyncLocalStorage instead of redirecting
 * (which would discard the result). Server components read the flash and
 * pass it to client form components as the initial `useActionState` value.
 *
 * This follows the Remix/Rails pattern — the form component becomes the
 * single source of truth for both with-JS (React state) and no-JS (flash).
 *
 * The flash data is server-side only — never serialized to cookies or headers.
 *
 * See design/08-forms-and-actions.md §"No-JS Error Round-Trip"
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ValidationErrors } from './action-client.js';

// ─── Types ───────────────────────────────────────────────────────────────

/**
 * Flash data injected into the re-render after a no-JS form submission.
 *
 * This is the action result from the server action, stored in ALS so server
 * components can read it and pass it to client form components as the initial
 * state for `useActionState`. This makes the form component a single source
 * of truth for both with-JS and no-JS paths.
 *
 * The shape matches `ActionResult<unknown>` — it's one of:
 * - `{ data: ... }` — success
 * - `{ validationErrors, submittedValues }` — validation failure
 * - `{ serverError }` — server error
 */
export interface FormFlashData {
  /** Success data from the action. */
  data?: unknown;
  /** Validation errors keyed by field name. `_root` for form-level errors. */
  validationErrors?: ValidationErrors;
  /** Raw submitted values for repopulating form fields. File objects are excluded. */
  submittedValues?: Record<string, unknown>;
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
 * render, not a re-render after a no-JS form submission).
 *
 * Pass the flash as the initial state to `useActionState` so the form
 * component has a single source of truth for both with-JS and no-JS paths:
 *
 * ```tsx
 * // app/contact/page.tsx (server component)
 * import { getFormFlash } from '@timber/app/server'
 *
 * export default function ContactPage() {
 *   const flash = getFormFlash()
 *   return <ContactForm flash={flash} />
 * }
 *
 * // app/contact/form.tsx (client component)
 * export function ContactForm({ flash }) {
 *   const [result, action, isPending] = useActionState(submitContact, flash)
 *   // result is the single source of truth — flash seeds it on no-JS
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
