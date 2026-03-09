/**
 * CSRF protection — Origin header validation.
 *
 * Auto-derived from the Host header for single-origin deployments.
 * Configurable via allowedOrigins for multi-origin setups.
 * Disable with csrf: false (not recommended outside local dev).
 *
 * See design/08-forms-and-actions.md §"CSRF Protection"
 * See design/13-security.md §"Security Testing Checklist" #6
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface CsrfConfig {
  /** Explicit list of allowed origins. Replaces Host-based auto-derivation. */
  allowedOrigins?: string[]
  /** Set to false to disable CSRF validation entirely. */
  csrf?: boolean
}

export type CsrfResult =
  | { ok: true }
  | { ok: false; status: 403 }

// ─── Constants ────────────────────────────────────────────────────────────

/** HTTP methods that are considered safe (no mutation). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// ─── Implementation ───────────────────────────────────────────────────────

/**
 * Validate the Origin header against the request's Host.
 *
 * For mutation methods (POST, PUT, PATCH, DELETE):
 * - If `csrf: false`, skip validation.
 * - If `allowedOrigins` is set, Origin must match one exactly (no wildcards).
 * - Otherwise, Origin's host must match the request's Host header.
 *
 * Safe methods (GET, HEAD, OPTIONS) always pass.
 */
export function validateCsrf(req: Request, config: CsrfConfig): CsrfResult {
  // Safe methods don't need CSRF protection
  if (SAFE_METHODS.has(req.method)) {
    return { ok: true }
  }

  // Explicitly disabled
  if (config.csrf === false) {
    return { ok: true }
  }

  const origin = req.headers.get('Origin')

  // No Origin header on a mutation → reject
  if (!origin) {
    return { ok: false, status: 403 }
  }

  // If allowedOrigins is configured, use that instead of Host-based derivation
  if (config.allowedOrigins) {
    const allowed = config.allowedOrigins.includes(origin)
    return allowed ? { ok: true } : { ok: false, status: 403 }
  }

  // Auto-derive from Host header
  const host = req.headers.get('Host')
  if (!host) {
    return { ok: false, status: 403 }
  }

  // Extract hostname from Origin URL and compare to Host header
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return { ok: false, status: 403 }
  }

  return originHost === host
    ? { ok: true }
    : { ok: false, status: 403 }
}
