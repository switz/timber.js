/**
 * Instrumentation — loads and runs the user's instrumentation.ts file.
 *
 * instrumentation.ts is a file convention at the project root that exports:
 * - register() — called once at server startup, before the first request
 * - onRequestError() — called for every unhandled server error
 * - logger — any object with info/warn/error/debug methods
 *
 * See design/17-logging.md §"instrumentation.ts — The Entry Point"
 */

import { setLogger, type TimberLogger } from './logger.js';

// ─── Instrumentation Types ────────────────────────────────────────────────

export namespace Instrumentation {
  export type OnRequestError = (
    error: unknown,
    request: RequestInfo,
    context: ErrorContext
  ) => void | Promise<void>;

  export interface RequestInfo {
    /** HTTP method: 'GET', 'POST', etc. */
    method: string;
    /** Request path: '/dashboard/projects/123' */
    path: string;
    /** Request headers as a plain object. */
    headers: Record<string, string>;
  }

  export interface ErrorContext {
    /** Which pipeline phase the error occurred in. */
    phase: 'proxy' | 'handler' | 'render' | 'action' | 'route';
    /** The route pattern: '/dashboard/projects/[id]' */
    routePath: string;
    /** Type of route that was matched. */
    routeType: 'page' | 'route' | 'action';
    /** Always set — OTEL trace ID or UUID fallback. */
    traceId: string;
  }
}

// ─── Instrumentation Module Shape ─────────────────────────────────────────

interface InstrumentationModule {
  register?: () => void | Promise<void>;
  onRequestError?: Instrumentation.OnRequestError;
  logger?: TimberLogger;
}

// ─── State ────────────────────────────────────────────────────────────────

let _initialized = false;
let _onRequestError: Instrumentation.OnRequestError | null = null;

/**
 * Load and initialize the user's instrumentation.ts module.
 *
 * - Awaits register() before returning (server blocks on this).
 * - Picks up the logger export and wires it into the framework logger.
 * - Stores onRequestError for later invocation.
 *
 * @param loader - Function that dynamically imports the user's instrumentation module.
 *                 Returns null if no instrumentation.ts exists.
 */
export async function loadInstrumentation(
  loader: () => Promise<InstrumentationModule | null>
): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  let mod: InstrumentationModule | null;
  try {
    mod = await loader();
  } catch (error) {
    console.error('[timber] Failed to load instrumentation.ts:', error);
    return;
  }

  if (!mod) return;

  // Wire up the logger export
  if (mod.logger && typeof mod.logger.info === 'function') {
    setLogger(mod.logger);
  }

  // Store onRequestError for later
  if (typeof mod.onRequestError === 'function') {
    _onRequestError = mod.onRequestError;
  }

  // Await register() — server does not accept requests until this resolves
  if (typeof mod.register === 'function') {
    try {
      await mod.register();
    } catch (error) {
      console.error('[timber] instrumentation.ts register() threw:', error);
      throw error;
    }
  }
}

/**
 * Call the user's onRequestError hook. Catches and logs any errors thrown
 * by the hook itself — it must not affect the response.
 */
export async function callOnRequestError(
  error: unknown,
  request: Instrumentation.RequestInfo,
  context: Instrumentation.ErrorContext
): Promise<void> {
  if (!_onRequestError) return;
  try {
    await _onRequestError(error, request, context);
  } catch (hookError) {
    console.error('[timber] onRequestError hook threw:', hookError);
  }
}

/**
 * Check if onRequestError is registered.
 */
export function hasOnRequestError(): boolean {
  return _onRequestError !== null;
}

/**
 * Reset instrumentation state. Test-only.
 */
export function resetInstrumentation(): void {
  _initialized = false;
  _onRequestError = null;
}
