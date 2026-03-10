/**
 * Shim: next/headers → timber server request context
 *
 * Provides headers() and cookies() stubs that throw clear errors
 * directing users to the timber API. timber uses explicit context
 * passing instead of Next.js's AsyncLocalStorage-based globals.
 */

/**
 * Not implemented in timber.js.
 *
 * timber passes headers via the request context object instead of
 * a global `headers()` function. Use `ctx.headers` in middleware,
 * access, or route handlers.
 *
 * @throws Always throws with a migration hint.
 */
export function headers(): never {
  throw new Error(
    'next/headers `headers()` is not available in timber.js. ' +
      'Use `ctx.headers` from your middleware/access/route handler context instead.'
  );
}

/**
 * Not implemented in timber.js.
 *
 * timber passes cookies via the request context object instead of
 * a global `cookies()` function. Use `ctx.headers.get("cookie")` in
 * middleware, access, or route handlers.
 *
 * @throws Always throws with a migration hint.
 */
export function cookies(): never {
  throw new Error(
    'next/headers `cookies()` is not available in timber.js. ' +
      'Use `ctx.headers.get("cookie")` from your middleware/access/route handler context instead.'
  );
}
