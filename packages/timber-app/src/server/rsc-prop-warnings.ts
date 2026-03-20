/**
 * Dev-mode RSC prop serialization warnings.
 *
 * Detects common non-serializable types in React Flight errors and provides
 * actionable suggestions with the specific fix for each type.
 *
 * React's dev build logs "Only plain objects can be passed to Client Components"
 * but the message is generic. This module adds timber-specific context:
 * - Identifies the exact type (RegExp, URL, class instance, etc.)
 * - Suggests the specific fix (e.g., .toString() for RegExp, .href for URL)
 * - References the serialization audit document
 *
 * Dev-only — zero overhead in production.
 *
 * Design doc: design/30-rsc-serialization-audit.md §"Identified Improvements" #1
 * Task: TIM-358
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface NonSerializableTypeInfo {
  /** The detected type name (e.g., 'RegExp', 'URL', 'class instance'). */
  type: string;
  /** Actionable fix suggestion. */
  suggestion: string;
}

// ─── Detection Patterns ──────────────────────────────────────────────────

/**
 * Detection rules for common non-serializable types.
 *
 * Each rule has a pattern to match against the error message and
 * the type info to return if matched. Rules are checked in order;
 * first match wins.
 */
const DETECTION_RULES: Array<{
  pattern: RegExp;
  info: NonSerializableTypeInfo;
}> = [
  {
    pattern: /RegExp/i,
    info: {
      type: 'RegExp',
      suggestion:
        'Use .toString() to serialize, and new RegExp() to reconstruct on the client.',
    },
  },
  {
    // URL appears as a class instance error, but we detect it by name
    pattern: /\bURL\b(?!SearchParams)/,
    info: {
      type: 'URL',
      suggestion: 'Pass .href or .toString() instead of the URL object.',
    },
  },
  {
    pattern: /URLSearchParams/,
    info: {
      type: 'URLSearchParams',
      suggestion:
        'Pass .toString() to serialize, or spread entries: Object.fromEntries(params).',
    },
  },
  {
    pattern: /Headers/,
    info: {
      type: 'Headers',
      suggestion:
        'Convert to a plain object: Object.fromEntries(headers.entries()).',
    },
  },
  {
    pattern: /Symbol/i,
    info: {
      type: 'Symbol',
      suggestion:
        'Symbols cannot be serialized. Use a string identifier instead.',
    },
  },
  {
    pattern: /Functions cannot be passed/i,
    info: {
      type: 'function',
      suggestion:
        'Functions cannot cross the RSC boundary. Mark with "use server" for server actions, ' +
        'or restructure to pass data instead of callbacks.',
    },
  },
  {
    pattern: /Classes or null prototypes/i,
    info: {
      type: 'class instance',
      suggestion:
        'Spread to a plain object: { ...instance } or extract the needed properties.',
    },
  },
  {
    // Generic fallback for "Only plain objects" errors not caught above
    pattern: /Only plain objects can be passed to Client Components/i,
    info: {
      type: 'non-serializable object',
      suggestion:
        'Convert to a plain object or primitive before passing to a client component. ' +
        'Supported types: string, number, boolean, null, undefined, Date, Map, Set, ' +
        'BigInt, Promise, ArrayBuffer, TypedArray, and plain objects/arrays.',
    },
  },
];

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Detect a non-serializable type from an RSC error message.
 *
 * Returns type info with an actionable fix, or null if the error
 * is not related to RSC prop serialization.
 */
export function detectNonSerializableType(
  errorMessage: string
): NonSerializableTypeInfo | null {
  if (!errorMessage) return null;

  for (const rule of DETECTION_RULES) {
    if (rule.pattern.test(errorMessage)) {
      return rule.info;
    }
  }

  return null;
}

/**
 * Format a human-readable warning message for a non-serializable RSC prop.
 *
 * Includes the type, suggestion, and a reference to the serialization audit doc.
 *
 * @param info - The detected type info
 * @param requestPath - Optional request path for context
 * @param originalMessage - Optional original error message for debugging
 */
export function formatRscPropWarning(
  info: NonSerializableTypeInfo,
  requestPath?: string,
  originalMessage?: string
): string {
  let msg =
    `Non-serializable RSC prop detected: ${info.type}\n` +
    `  Fix: ${info.suggestion}\n` +
    '  See: design/30-rsc-serialization-audit.md for full type support matrix';

  if (requestPath) {
    msg += `\n  Request: ${requestPath}`;
  }

  if (originalMessage) {
    msg += `\n  Original error: ${originalMessage}`;
  }

  return msg;
}

/**
 * Check an RSC onError error for non-serializable prop patterns and emit
 * a dev warning if detected.
 *
 * Called from the RSC renderToReadableStream onError callback.
 * No-ops in production.
 *
 * @param error - The error from onError
 * @param requestPath - The request pathname for context
 * @returns true if a warning was emitted
 */
export function checkAndWarnRscPropError(
  error: unknown,
  requestPath: string
): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (!(error instanceof Error)) return false;

  const info = detectNonSerializableType(error.message);
  if (!info) return false;

  const warning = formatRscPropWarning(info, requestPath, error.message);
  process.stderr.write(`\x1b[33m[timber]\x1b[0m ${warning}\n`);
  return true;
}
