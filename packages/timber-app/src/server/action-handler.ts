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
import {
  runWithRequestContext,
  setMutableCookieContext,
  getSetCookieHeaders,
} from './request-context.js';
import { handleActionError } from './action-client.js';
import { enforceBodyLimits, enforceFieldLimit, type BodyLimitsConfig } from './body-limits.js';
import { parseFormData } from './form-data.js';
import type { FormFlashData } from './form-flash.js';

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
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    return true;
  }

  return false;
}

// ─── Handler ──────────────────────────────────────────────────────────────

/** Signal from handleFormAction to re-render the page with flash data instead of redirecting. */
export interface FormRerender {
  rerender: FormFlashData;
}

/**
 * Handle a server action request.
 *
 * Returns a Response, a FormRerender signal (for no-JS validation failure re-render),
 * or null if this isn't actually an action request (e.g., a regular form POST to an API route).
 */
export async function handleActionRequest(
  req: Request,
  config: ActionDispatchConfig
): Promise<Response | FormRerender | null> {
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
  // Actions are a mutable context — they can set cookies (design/29-cookies.md).
  return runWithRequestContext(req, async () => {
    setMutableCookieContext(true);
    const actionId = req.headers.get('x-rsc-action');

    let result: Response | FormRerender | null;
    if (actionId) {
      // With-JS path: client sent action ID in header, args in body
      result = await handleRscAction(req, actionId, config);
    } else {
      // No-JS path: form POST with React's hidden action fields
      result = await handleFormAction(req, config);
    }

    // Apply cookie jar to action responses
    if (result instanceof Response) {
      for (const value of getSetCookieHeaders()) {
        result.headers.append('Set-Cookie', value);
      }
    }
    return result;
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
  const actionFn = (await loadServerAction(actionId)) as (...args: unknown[]) => Promise<unknown>;

  // Decode the args from the request body (RSC wire format)
  const contentType = req.headers.get('Content-Type') ?? '';
  let args: unknown[];

  if (contentType.includes('multipart/form-data')) {
    // FormData-based args (file uploads, etc.)
    const formData = await req.formData();
    // Enforce field count limit after parsing FormData.
    const fieldResult = enforceFieldLimit(formData, config.bodyLimits ?? {});
    if (!fieldResult.ok) {
      return new Response(null, { status: fieldResult.status });
    }
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

  // Handle redirect — encode in RSC stream for client-side SPA navigation.
  // The client detects X-Timber-Redirect and calls router.navigate() instead
  // of following an HTTP 302 (which would cause a full page reload).
  if (result.redirectTo) {
    const redirectPayload = {
      _redirect: result.redirectTo,
      _status: result.redirectStatus ?? 302,
    };
    const rscStream = renderToReadableStream(redirectPayload);
    return new Response(rscStream, {
      status: 200,
      headers: {
        'Content-Type': RSC_CONTENT_TYPE,
        'X-Timber-Redirect': result.redirectTo,
      },
    });
  }

  // Render the action result as an RSC stream.
  // When revalidatePath was called, piggyback the revalidated element tree
  // alongside the action result in a single renderToReadableStream call.
  // The client detects the X-Timber-Revalidation header and unpacks both.
  const headers: Record<string, string> = {
    'Content-Type': RSC_CONTENT_TYPE,
  };

  let payload: unknown;
  if (result.revalidation) {
    // Wrapper object — Next.js-style pattern: action result + element tree
    // serialized together so React Flight handles both in one stream.
    payload = {
      _action: result.actionResult,
      _tree: result.revalidation.element,
    };
    headers['X-Timber-Revalidation'] = '1';
    // Forward head elements as JSON so the client can update <head>.
    if (result.revalidation.headElements.length > 0) {
      headers['X-Timber-Head'] = JSON.stringify(result.revalidation.headElements);
    }
  } else {
    payload = result.actionResult;
  }

  const rscStream = renderToReadableStream(payload);

  return new Response(rscStream, {
    status: 200,
    headers,
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
): Promise<Response | FormRerender | null> {
  // Clone before consuming — if this turns out not to be a server action form,
  // we return null and the original request body must remain readable for
  // downstream route handlers. Clone is cheap (shares the body buffer until read).
  const formData = await req.clone().formData();

  // Enforce field count limit after parsing FormData.
  const fieldResult = enforceFieldLimit(formData, config.bodyLimits ?? {});
  if (!fieldResult.ok) {
    return new Response(null, { status: fieldResult.status });
  }

  // Check if this is actually a React server action form.
  // If there's no $ACTION_REF_* or $ACTION_KEY, it's a regular form POST
  // that should be handled by the route's route handler, not here.
  // React uses `$ACTION_REF_` + identifierPrefix — since we don't set one,
  // the suffix is empty. Check for any key starting with $ACTION_REF_ or $ACTION_ID_.
  const allKeys = [...formData.keys()];
  const hasActionField = allKeys.some(
    (k) => k.startsWith('$ACTION_REF_') || k.startsWith('$ACTION_ID_')
  );
  if (!hasActionField && !formData.has('$ACTION_KEY')) {
    return null;
  }

  // Capture submitted values for re-render on validation failure.
  // Parse before decodeAction consumes the FormData.
  const submittedValues = parseFormData(formData);

  // decodeAction resolves the action function from the form data's hidden fields.
  // It returns a bound function with the form data already applied.
  const actionFn = (await decodeAction(formData)) as (...args: unknown[]) => Promise<unknown>;

  // Execute the action — no additional args needed (form data is already bound).
  // Errors are caught to prevent stack traces from leaking in the response.
  let result;
  try {
    result = await executeAction(actionFn, [], {
      renderer: config.revalidateRenderer,
    });
  } catch (error) {
    console.error('[timber] server action error:', error);

    // Return the error as flash data for re-render.
    // handleActionError produces { serverError } for ActionErrors
    // and { serverError: { code: 'INTERNAL_ERROR' } } for unexpected errors.
    const errorResult = handleActionError(error);
    return {
      rerender: {
        ...errorResult,
        submittedValues,
      },
    };
  }

  // Handle redirect from the action (e.g. redirect() called in the action body)
  if (result.redirectTo) {
    return new Response(null, {
      status: result.redirectStatus ?? 302,
      headers: { Location: result.redirectTo },
    });
  }

  // Re-render the page with the action result as flash data.
  // The server component reads the flash via getFormFlash() and passes it
  // to the client form component as the initial useActionState value.
  // This handles both success ({ data }) and validation failure
  // ({ validationErrors, submittedValues }) — the form is the single source of truth.
  const actionResult = result.actionResult as FormFlashData;
  return { rerender: actionResult };
}
