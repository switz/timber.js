/**
 * Server Action Request Handler — dispatches incoming action POST requests.
 *
 * Handles both JS-enabled (RSC) and no-JS (HTML form POST) action submissions.
 * Wired into the RSC entry to intercept action requests before the render pipeline.
 *
 * Flow:
 * 1. Detect action request (POST with `x-rsc-action` header or form action fields)
 * 2. CSRF validation
 * 3. Load and execute the server action
 * 4. Return RSC stream (with-JS) or 302 redirect (no-JS)
 *
 * See design/08-forms-and-actions.md
 */

import {
  loadServerAction,
  decodeReply,
  decodeAction,
  renderToReadableStream,
} from '@vitejs/plugin-rsc/rsc';

import { validateCsrf, type CsrfConfig } from './csrf.js';
import { executeAction, type RevalidateRenderer } from './actions.js';
import { runWithRequestContext } from './request-context.js';
import { handleActionError } from './action-client.js';
import { enforceBodyLimits, type BodyLimitsConfig } from './body-limits.js';

// ─── Types ────────────────────────────────────────────────────────────────

/** Configuration for the action handler. */
export interface ActionDispatchConfig {
  /** CSRF configuration. */
  csrf: CsrfConfig;
  /** Renderer for revalidatePath — produces RSC flight payloads. */
  revalidateRenderer?: RevalidateRenderer;
  /** Body size limits (from timber.config.ts). */
  bodyLimits?: BodyLimitsConfig;
}

// ─── Constants ────────────────────────────────────────────────────────────

const RSC_CONTENT_TYPE = 'text/x-component';

// ─── Detection ────────────────────────────────────────────────────────────

/**
 * Check if a request is a server action invocation.
 *
 * Two cases:
 * - With JS: POST with `x-rsc-action` header (client callServer dispatch)
 * - Without JS: POST with form data containing `$ACTION_REF` or `$ACTION_KEY`
 *   (React's progressive enhancement hidden fields)
 */
export function isActionRequest(req: Request): boolean {
  if (req.method !== 'POST') return false;

  // With-JS case: explicit action header
  if (req.headers.get('x-rsc-action')) return true;

  // No-JS case: check Content-Type for form data
  const ct = req.headers.get('Content-Type') ?? '';
  if (
    ct.includes('application/x-www-form-urlencoded') ||
    ct.includes('multipart/form-data')
  ) {
    return true;
  }

  return false;
}

// ─── Handler ──────────────────────────────────────────────────────────────

/**
 * Handle a server action request.
 *
 * Returns a Response, or null if this isn't actually an action request
 * (e.g., a regular form POST to an API route).
 */
export async function handleActionRequest(
  req: Request,
  config: ActionDispatchConfig
): Promise<Response | null> {
  // CSRF validation — reject cross-origin mutation requests.
  const csrfResult = validateCsrf(req, config.csrf);
  if (!csrfResult.ok) {
    return new Response(null, { status: csrfResult.status });
  }

  // Body size limits — reject oversized requests before parsing.
  // Multipart requests (file uploads) get a higher limit than regular actions.
  const bodyKind = (req.headers.get('Content-Type') ?? '').includes('multipart/form-data')
    ? 'upload'
    : 'action';
  const limitsResult = enforceBodyLimits(req, bodyKind, config.bodyLimits ?? {});
  if (!limitsResult.ok) {
    return new Response(null, { status: limitsResult.status });
  }

  // Run inside request context so headers(), cookies() work in actions.
  return runWithRequestContext(req, async () => {
    const actionId = req.headers.get('x-rsc-action');

    if (actionId) {
      // With-JS path: client sent action ID in header, args in body
      return handleRscAction(req, actionId, config);
    }

    // No-JS path: form POST with React's hidden action fields
    return handleFormAction(req, config);
  });
}

// ─── With-JS Action ───────────────────────────────────────────────────────

/**
 * Handle an RSC action request (JavaScript enabled).
 *
 * The client serialized the action args via `encodeReply` and sent them
 * as the request body. The action ID is in the `x-rsc-action` header.
 */
async function handleRscAction(
  req: Request,
  actionId: string,
  config: ActionDispatchConfig
): Promise<Response> {
  // Load the server action function by reference ID
  const actionFn = (await loadServerAction(actionId)) as (
    ...args: unknown[]
  ) => Promise<unknown>;

  // Decode the args from the request body (RSC wire format)
  const contentType = req.headers.get('Content-Type') ?? '';
  let args: unknown[];

  if (contentType.includes('multipart/form-data')) {
    // FormData-based args (file uploads, etc.)
    const formData = await req.formData();
    args = (await decodeReply(formData)) as unknown[];
  } else {
    // Text-based args
    const body = await req.text();
    args = (await decodeReply(body)) as unknown[];
  }

  // Execute the action with revalidation tracking.
  // Errors are caught here so raw 'use server' functions (not using
  // createActionClient) still return structured error responses instead
  // of leaking stack traces as 500s.
  let result;
  try {
    result = await executeAction(actionFn, args, {
      renderer: config.revalidateRenderer,
    });
  } catch (error) {
    // Log full error server-side for debugging
    console.error('[timber] server action error:', error);

    // Return structured error response — ActionError gets its code/data,
    // unexpected errors get sanitized { code: 'INTERNAL_ERROR' }
    const errorResult = handleActionError(error);
    const rscStream = renderToReadableStream(errorResult);
    return new Response(rscStream, {
      status: 200,
      headers: { 'Content-Type': RSC_CONTENT_TYPE },
    });
  }

  // Handle redirect
  if (result.redirectTo) {
    return new Response(null, {
      status: result.redirectStatus ?? 302,
      headers: { Location: result.redirectTo },
    });
  }

  // Render the action result as an RSC stream.
  // If revalidatePath was called, the RSC payload is piggybacked
  // by rendering both the result and the revalidated tree.
  const rscStream = renderToReadableStream(result.actionResult);

  return new Response(rscStream, {
    status: 200,
    headers: {
      'Content-Type': RSC_CONTENT_TYPE,
    },
  });
}

// ─── No-JS Form Action ───────────────────────────────────────────────────

/**
 * Handle a no-JS form action (progressive enhancement fallback).
 *
 * React embeds `$ACTION_REF` / `$ACTION_KEY` hidden fields in the form.
 * We use `decodeAction` to resolve the action function from the form data,
 * execute it, then redirect back to the form's page.
 */
async function handleFormAction(
  req: Request,
  config: ActionDispatchConfig
): Promise<Response | null> {
  const formData = await req.formData();

  // Check if this is actually a React server action form.
  // If there's no $ACTION_REF or $ACTION_KEY, it's a regular form POST
  // that should be handled by the route's route handler, not here.
  if (!formData.has('$ACTION_REF_1') && !formData.has('$ACTION_KEY')) {
    // Not a React server action form — return null to let the pipeline handle it
    return null;
  }

  // decodeAction resolves the action function from the form data's hidden fields.
  // It returns a bound function with the form data already applied.
  const actionFn = (await decodeAction(formData)) as (
    ...args: unknown[]
  ) => Promise<unknown>;

  // Execute the action — no additional args needed (form data is already bound).
  // Errors are caught to prevent stack traces from leaking in the response.
  let result;
  try {
    result = await executeAction(actionFn, [], {
      renderer: config.revalidateRenderer,
    });
  } catch (error) {
    // Log full error server-side
    console.error('[timber] server action error:', error);

    // No-JS path: redirect back to the page. There's no RSC client to
    // receive structured error data, so the best we can do is redirect
    // back and not leak error details. The error is logged server-side.
    const url = new URL(req.url);
    return new Response(null, {
      status: 302,
      headers: { Location: url.pathname + url.search },
    });
  }

  // Handle redirect from the action itself
  if (result.redirectTo) {
    return new Response(null, {
      status: result.redirectStatus ?? 302,
      headers: { Location: result.redirectTo },
    });
  }

  // No-JS: redirect back to the same page to show updated state (PRG pattern)
  const url = new URL(req.url);
  return new Response(null, {
    status: 302,
    headers: { Location: url.pathname + url.search },
  });
}
