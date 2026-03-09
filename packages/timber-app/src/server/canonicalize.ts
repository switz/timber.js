/**
 * URL canonicalization — runs once at the request boundary.
 *
 * Every layer (proxy.ts, middleware.ts, access.ts, components) sees the same
 * canonical path. No re-decoding occurs at any later stage.
 *
 * See design/07-routing.md §"URL Canonicalization & Security"
 */

/** Result of canonicalization — either a clean path or a rejection. */
export type CanonicalizeResult = { ok: true; pathname: string } | { ok: false; status: 400 };

/**
 * Encoded separators that produce a 400 rejection.
 * %2f (/) and %5c (\) cause path-confusion attacks.
 */
const ENCODED_SEPARATOR_RE = /%2f|%5c/i;

/** Null byte — rejected. */
const NULL_BYTE_RE = /%00/i;

/**
 * Canonicalize a URL pathname.
 *
 * 1. Reject encoded separators (%2f, %5c) and null bytes (%00)
 * 2. Single percent-decode
 * 3. Collapse // → /
 * 4. Resolve .. segments (reject if escaping root)
 * 5. Strip trailing slash (except root "/")
 *
 * @param rawPathname - The raw pathname from the request URL (percent-encoded)
 * @param stripTrailingSlash - Whether to strip trailing slashes. Default: true.
 */
export function canonicalize(rawPathname: string, stripTrailingSlash = true): CanonicalizeResult {
  // Step 1: Reject dangerous encoded sequences BEFORE decoding.
  // This must happen on the raw input so %252f doesn't bypass after a single decode.
  if (ENCODED_SEPARATOR_RE.test(rawPathname)) {
    return { ok: false, status: 400 };
  }
  if (NULL_BYTE_RE.test(rawPathname)) {
    return { ok: false, status: 400 };
  }

  // Step 2: Single percent-decode.
  // Double-encoded input (%2561 → %61) stays as %61 — not decoded again.
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPathname);
  } catch {
    // Malformed percent-encoding → 400
    return { ok: false, status: 400 };
  }

  // Reject null bytes that appeared after decoding (from valid %00-like sequences
  // that weren't caught above — belt and suspenders).
  if (decoded.includes('\0')) {
    return { ok: false, status: 400 };
  }

  // Backslash is NOT a path separator — keep as literal character.
  // But reject if it would create // after normalization (e.g., /\evil.com).
  // We do NOT convert \ to / — it stays as a literal.

  // Step 3: Collapse consecutive slashes.
  let pathname = decoded.replace(/\/\/+/g, '/');

  // Step 4: Resolve .. and . segments.
  const segments = pathname.split('/');
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === '..') {
      if (resolved.length <= 1) {
        // Trying to escape root — 400
        return { ok: false, status: 400 };
      }
      resolved.pop();
    } else if (seg !== '.') {
      resolved.push(seg);
    }
  }

  pathname = resolved.join('/') || '/';

  // Step 5: Strip trailing slash (except root "/").
  if (stripTrailingSlash && pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  return { ok: true, pathname };
}
