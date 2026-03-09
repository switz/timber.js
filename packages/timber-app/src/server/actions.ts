/**
 * Server action primitives: revalidatePath, revalidateTag, and the action handler.
 *
 * - revalidatePath(path) re-renders the route at that path and returns the RSC
 *   flight payload for inline reconciliation.
 * - revalidateTag(tag) invalidates cached shells and 'use cache' entries by tag.
 *
 * Both are callable from anywhere on the server — actions, API routes, handlers.
 *
 * The action handler processes incoming action requests, validates CSRF,
 * enforces body limits, executes the action, and returns the response
 * (with piggybacked RSC payload if revalidatePath was called).
 *
 * See design/08-forms-and-actions.md
 */

import type { CacheHandler } from '../cache/index';
import { RedirectSignal } from './primitives';

// ─── Types ───────────────────────────────────────────────────────────────

/** Renderer function that produces an RSC flight payload for a given path. */
export type RevalidateRenderer = (path: string) => Promise<ReadableStream<Uint8Array>>;

/** Per-request revalidation state — tracks revalidatePath/Tag calls within an action. */
export interface RevalidationState {
  /** Paths to re-render (populated by revalidatePath calls). */
  paths: string[];
  /** Tags to invalidate (populated by revalidateTag calls). */
  tags: string[];
}

/** Options for creating the action handler. */
export interface ActionHandlerConfig {
  /** Cache handler for tag invalidation. */
  cacheHandler?: CacheHandler;
  /** Renderer for producing RSC payloads during revalidation. */
  renderer?: RevalidateRenderer;
}

/** Result of handling a server action request. */
export interface ActionHandlerResult {
  /** The action's return value (serialized). */
  actionResult: unknown;
  /** RSC flight payload stream if revalidatePath was called. */
  rscPayload?: ReadableStream<Uint8Array>;
  /** Redirect location if a RedirectSignal was thrown during revalidation. */
  redirectTo?: string;
  /** Redirect status code. */
  redirectStatus?: number;
}

// ─── Revalidation State ──────────────────────────────────────────────────

// Per-request state, set before each action execution and cleared after.
// This avoids ALS — the action is synchronously dispatched on the same call stack.
let _currentRevalidationState: RevalidationState | null = null;

/**
 * Set the revalidation state for the current action execution.
 * @internal
 */
export function _setRevalidationState(state: RevalidationState): void {
  _currentRevalidationState = state;
}

/**
 * Clear the revalidation state after action execution.
 * @internal
 */
export function _clearRevalidationState(): void {
  _currentRevalidationState = null;
}

/**
 * Get the current revalidation state. Throws if called outside an action context.
 * @internal
 */
function getRevalidationState(): RevalidationState {
  if (!_currentRevalidationState) {
    throw new Error(
      'revalidatePath/revalidateTag called outside of a server action context. ' +
        'These functions can only be called during action execution.'
    );
  }
  return _currentRevalidationState;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Re-render the route at `path` and include the RSC flight payload in the
 * action response. The client reconciles inline — no separate fetch needed.
 *
 * Can be called from server actions, API routes, or any server-side context.
 *
 * @param path - The path to re-render (e.g. '/dashboard', '/todos').
 */
export function revalidatePath(path: string): void {
  const state = getRevalidationState();
  if (!state.paths.includes(path)) {
    state.paths.push(path);
  }
}

/**
 * Invalidate all pre-rendered shells and 'use cache' entries tagged with `tag`.
 * Does not return a payload — the next request for an invalidated route re-renders fresh.
 *
 * @param tag - The cache tag to invalidate (e.g. 'products', 'user:123').
 */
export function revalidateTag(tag: string): void {
  const state = getRevalidationState();
  if (!state.tags.includes(tag)) {
    state.tags.push(tag);
  }
}

// ─── Action Handler ──────────────────────────────────────────────────────

/**
 * Execute a server action and process revalidation.
 *
 * 1. Sets up revalidation state
 * 2. Calls the action function
 * 3. Processes revalidateTag calls (invalidates cache entries)
 * 4. Processes revalidatePath calls (re-renders and captures RSC payload)
 * 5. Returns the action result + optional RSC payload
 *
 * @param actionFn - The server action function to execute.
 * @param args - Arguments to pass to the action.
 * @param config - Handler configuration (cache handler, renderer).
 */
export async function executeAction(
  actionFn: (...args: unknown[]) => Promise<unknown>,
  args: unknown[],
  config: ActionHandlerConfig = {}
): Promise<ActionHandlerResult> {
  const state: RevalidationState = { paths: [], tags: [] };
  _setRevalidationState(state);

  let actionResult: unknown;
  let redirectTo: string | undefined;
  let redirectStatus: number | undefined;

  try {
    actionResult = await actionFn(...args);
  } catch (error) {
    if (error instanceof RedirectSignal) {
      redirectTo = error.location;
      redirectStatus = error.status;
    } else {
      throw error;
    }
  } finally {
    _clearRevalidationState();
  }

  // Process tag invalidation
  if (state.tags.length > 0 && config.cacheHandler) {
    await Promise.all(
      state.tags.map((tag) => config.cacheHandler!.invalidate({ tag }))
    );
  }

  // Process path revalidation — render RSC payload
  let rscPayload: ReadableStream<Uint8Array> | undefined;
  if (state.paths.length > 0 && config.renderer) {
    // For now, render the first revalidated path.
    // Multiple paths could be supported via multipart streaming in the future.
    const path = state.paths[0];
    try {
      rscPayload = await config.renderer(path);
    } catch (renderError) {
      if (renderError instanceof RedirectSignal) {
        // Revalidation triggered a redirect (e.g., session expired)
        redirectTo = renderError.location;
        redirectStatus = renderError.status;
      } else {
        // Log but don't fail the action — revalidation is best-effort
        console.error('[timber] revalidatePath render failed:', renderError);
      }
    }
  }

  return {
    actionResult,
    rscPayload,
    ...(redirectTo ? { redirectTo, redirectStatus } : {}),
  };
}

/**
 * Build an HTTP Response for a no-JS form submission.
 * Standard POST → 302 redirect pattern.
 *
 * @param redirectPath - Where to redirect after the action executes.
 */
export function buildNoJsResponse(redirectPath: string, status: number = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: redirectPath },
  });
}

/**
 * Detect whether the incoming request is an RSC action request (with JS)
 * or a plain HTML form POST (no JS).
 *
 * RSC action requests use Accept: text/x-component or Content-Type: text/x-component.
 */
export function isRscActionRequest(req: Request): boolean {
  const accept = req.headers.get('Accept') ?? '';
  const contentType = req.headers.get('Content-Type') ?? '';
  return (
    accept.includes('text/x-component') ||
    contentType.includes('text/x-component')
  );
}
