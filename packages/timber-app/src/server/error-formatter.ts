/**
 * Error Formatter — rewrites SSR/RSC error messages to surface user code.
 *
 * When React or Vite throw errors during SSR, stack traces reference
 * vendored dependency paths (e.g. `.vite/deps_ssr/@vitejs_plugin-rsc_vendor_...`)
 * and mangled export names (`__vite_ssr_export_default__`). This module
 * rewrites error messages and stack traces to point at user code instead.
 *
 * Dev-only — in production, errors go through the structured logger
 * without formatting.
 */

// ─── Stack Trace Rewriting ──────────────────────────────────────────────────

/**
 * Patterns that identify internal Vite/RSC vendor paths in stack traces.
 * These are replaced with human-readable labels.
 */
const VENDOR_PATH_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /node_modules\/\.vite\/deps_ssr\/@vitejs_plugin-rsc_vendor_react-server-dom[^\s)]+/g,
    replacement: '<react-server-dom>',
  },
  {
    pattern: /node_modules\/\.vite\/deps_ssr\/@vitejs_plugin-rsc_vendor[^\s)]+/g,
    replacement: '<rsc-vendor>',
  },
  {
    pattern: /node_modules\/\.vite\/deps_ssr\/[^\s)]+/g,
    replacement: '<vite-dep>',
  },
  {
    pattern: /node_modules\/\.vite\/deps\/[^\s)]+/g,
    replacement: '<vite-dep>',
  },
];

/**
 * Patterns that identify Vite-mangled export names in error messages.
 */
const MANGLED_NAME_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /__vite_ssr_export_default__/g,
    replacement: '<default export>',
  },
  {
    pattern: /__vite_ssr_export_(\w+)__/g,
    replacement: '<export $1>',
  },
];

/**
 * Rewrite an error's message and stack to replace internal Vite paths
 * and mangled names with human-readable labels.
 */
export function formatSsrError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  let message = error.message;
  let stack = error.stack ?? '';

  // Rewrite mangled names in the message
  for (const { pattern, replacement } of MANGLED_NAME_PATTERNS) {
    message = message.replace(pattern, replacement);
  }

  // Rewrite vendor paths in the stack
  for (const { pattern, replacement } of VENDOR_PATH_PATTERNS) {
    stack = stack.replace(pattern, replacement);
  }

  // Rewrite mangled names in the stack too
  for (const { pattern, replacement } of MANGLED_NAME_PATTERNS) {
    stack = stack.replace(pattern, replacement);
  }

  // Extract hints from React-specific error patterns
  const hint = extractErrorHint(error.message);

  // Build formatted output: cleaned message, hint (if any), then cleaned stack
  const parts: string[] = [];
  parts.push(message);
  if (hint) {
    parts.push(`  → ${hint}`);
  }

  // Include only the user-code frames from the stack (skip the first line
  // which is the message itself, and filter out vendor-only frames)
  const userFrames = extractUserFrames(stack);
  if (userFrames.length > 0) {
    parts.push('');
    parts.push('  User code in stack:');
    for (const frame of userFrames) {
      parts.push(`    ${frame}`);
    }
  }

  return parts.join('\n');
}

// ─── Error Hint Extraction ──────────────────────────────────────────────────

/**
 * Extract a human-readable hint from common React/RSC error messages.
 *
 * React error messages contain useful information but the surrounding
 * context (vendor paths, mangled names) obscures it. This extracts the
 * actionable part as a one-line hint.
 */
function extractErrorHint(message: string): string | null {
  // "Functions cannot be passed directly to Client Components"
  // Extract the component and prop name from the JSX-like syntax in the message
  const fnPassedMatch = message.match(
    /Functions cannot be passed directly to Client Components/
  );
  if (fnPassedMatch) {
    // Try to extract the prop name from the message
    // React formats: <... propName={function ...} ...>
    const propMatch = message.match(/<[^>]*?\s(\w+)=\{function/);
    if (propMatch) {
      return `Prop "${propMatch[1]}" is a function — mark it "use server" or call it before passing`;
    }
    return 'A function prop was passed to a Client Component — mark it "use server" or call it before passing';
  }

  // "Objects are not valid as a React child"
  if (message.includes('Objects are not valid as a React child')) {
    return 'An object was rendered as JSX children — convert to string or extract the value';
  }

  // "Cannot read properties of undefined/null"
  const nullRefMatch = message.match(
    /Cannot read propert(?:y|ies) of (undefined|null) \(reading '(\w+)'\)/
  );
  if (nullRefMatch) {
    return `Accessed .${nullRefMatch[2]} on ${nullRefMatch[1]} — check that the value exists`;
  }

  // "X is not a function"
  const notFnMatch = message.match(/(\w+) is not a function/);
  if (notFnMatch) {
    return `"${notFnMatch[1]}" is not a function — check imports and exports`;
  }

  // "Element type is invalid"
  if (message.includes('Element type is invalid')) {
    return 'A component resolved to undefined/null — check default exports and import paths';
  }

  return null;
}

// ─── Stack Frame Filtering ──────────────────────────────────────────────────

/**
 * Extract stack frames that reference user code (not node_modules,
 * not framework internals).
 *
 * Returns at most 5 frames to keep output concise.
 */
function extractUserFrames(stack: string): string[] {
  const lines = stack.split('\n');
  const userFrames: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip non-frame lines
    if (!trimmed.startsWith('at ')) continue;
    // Skip node_modules, vendor, and internal frames
    if (
      trimmed.includes('node_modules') ||
      trimmed.includes('<react-server-dom>') ||
      trimmed.includes('<rsc-vendor>') ||
      trimmed.includes('<vite-dep>') ||
      trimmed.includes('node:internal')
    ) {
      continue;
    }
    userFrames.push(trimmed);
    if (userFrames.length >= 5) break;
  }

  return userFrames;
}
