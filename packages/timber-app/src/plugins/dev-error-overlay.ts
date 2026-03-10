/**
 * Dev error overlay — formats and sends errors to Vite's browser overlay and stderr.
 *
 * Integrates with Vite's built-in error overlay (`server.ssrFixStacktrace` +
 * `server.hot.send`) rather than implementing a custom overlay.
 *
 * Design doc: 21-dev-server.md §"Error Overlay"
 */

import type { ViteDevServer } from 'vite';

// ─── Types ──────────────────────────────────────────────────────────────────

/** The phase of the pipeline where the error occurred. */
export type ErrorPhase =
  | 'module-transform'
  | 'proxy'
  | 'middleware'
  | 'access'
  | 'render'
  | 'handler';

/** Labels for terminal output. */
const PHASE_LABELS: Record<ErrorPhase, string> = {
  'module-transform': 'Module Transform',
  'proxy': 'Proxy',
  'middleware': 'Middleware',
  'access': 'Access Check',
  'render': 'RSC Render',
  'handler': 'Route Handler',
};

// ─── Frame Classification ───────────────────────────────────────────────────

export type FrameType = 'app' | 'framework' | 'internal';

/**
 * Classify a stack frame line by origin.
 *
 * - 'app': user application code (in project root, not node_modules)
 * - 'framework': timber-app internal code
 * - 'internal': node_modules, Node.js internals
 */
export function classifyFrame(frameLine: string, projectRoot: string): FrameType {
  // Strip leading whitespace and "at "
  const trimmed = frameLine.trim();

  if (trimmed.includes('packages/timber-app/')) return 'framework';
  if (trimmed.includes('node_modules/')) return 'internal';
  if (trimmed.startsWith('at node:') || trimmed.includes('(node:')) return 'internal';
  if (trimmed.includes(projectRoot)) return 'app';

  return 'internal';
}

// ─── Component Stack Extraction ─────────────────────────────────────────────

/**
 * Extract the React component stack from an error, if present.
 * React attaches this as `componentStack` during renderToReadableStream errors.
 */
export function extractComponentStack(error: unknown): string | null {
  if (
    error &&
    typeof error === 'object' &&
    'componentStack' in error &&
    typeof (error as Record<string, unknown>).componentStack === 'string'
  ) {
    return (error as Record<string, unknown>).componentStack as string;
  }
  return null;
}

// ─── First App Frame Parsing ────────────────────────────────────────────────

interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

/**
 * Parse the first application frame from a stack trace.
 * Returns file/line/column for the overlay's `loc` field.
 */
export function parseFirstAppFrame(stack: string, projectRoot: string): SourceLocation | null {
  const lines = stack.split('\n');
  // Match patterns like:
  //   at functionName (/absolute/path:line:column)
  //   at /absolute/path:line:column
  const parenRegex = /\(([^)]+):(\d+):(\d+)\)/;
  const bareRegex = /at (\/[^:]+):(\d+):(\d+)/;

  for (const line of lines) {
    if (classifyFrame(line, projectRoot) !== 'app') continue;

    const match = parenRegex.exec(line) ?? bareRegex.exec(line);
    if (!match) continue;

    const [, file, lineNum, col] = match;
    if (file && lineNum && col) {
      return { file, line: parseInt(lineNum, 10), column: parseInt(col, 10) };
    }
  }

  return null;
}

// ─── Error Phase Classification ─────────────────────────────────────────────

/**
 * Classify the error phase by inspecting the error's stack trace.
 * Falls back to 'render' if no specific phase can be determined.
 */
export function classifyErrorPhase(error: Error, projectRoot: string): ErrorPhase {
  const stack = error.stack ?? '';

  // Check for React component stack (render error)
  if (extractComponentStack(error)) return 'render';

  // Check for specific file patterns in app frames
  const appRoot = projectRoot.replace(/\/$/, '');
  if (stack.includes(`${appRoot}/app/`) || stack.includes('/app/')) {
    if (stack.includes('/middleware.ts') || stack.includes('/middleware.js')) return 'middleware';
    if (stack.includes('/access.ts') || stack.includes('/access.js')) return 'access';
    if (stack.includes('/route.ts') || stack.includes('/route.js')) return 'handler';
  }

  return 'render';
}

// ─── Terminal Formatting ────────────────────────────────────────────────────

// ANSI codes
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

/**
 * Format an error for terminal output.
 *
 * - Red for the error message and phase label
 * - Dim for framework-internal frames
 * - Normal for application frames
 * - Separate section for component stack (if present)
 */
export function formatTerminalError(error: Error, phase: ErrorPhase, projectRoot: string): string {
  const lines: string[] = [];

  // Phase header + error message
  lines.push(`${RED}${BOLD}[timber] ${PHASE_LABELS[phase]} Error${RESET}`);
  lines.push(`${RED}${error.message}${RESET}`);
  lines.push('');

  // Component stack (if present)
  const componentStack = extractComponentStack(error);
  if (componentStack) {
    lines.push(`${BOLD}Component Stack:${RESET}`);
    for (const csLine of componentStack.trim().split('\n')) {
      lines.push(`  ${csLine.trim()}`);
    }
    lines.push('');
  }

  // Stack trace with frame dimming
  if (error.stack) {
    lines.push(`${BOLD}Stack Trace:${RESET}`);
    const stackLines = error.stack.split('\n').slice(1); // Skip the first line (message)
    for (const stackLine of stackLines) {
      const frameType = classifyFrame(stackLine, projectRoot);
      if (frameType === 'app') {
        lines.push(stackLine);
      } else {
        lines.push(`${DIM}${stackLine}${RESET}`);
      }
    }
  }

  return lines.join('\n');
}

// ─── Overlay Integration ────────────────────────────────────────────────────

/**
 * Send an error to Vite's browser overlay and log it to stderr.
 *
 * Uses `server.ssrFixStacktrace()` to map stack traces back to source,
 * then sends the error via `server.hot.send()` for the browser overlay.
 *
 * The dev server remains running — errors are handled, not fatal.
 */
export function sendErrorToOverlay(
  server: ViteDevServer,
  error: Error,
  phase: ErrorPhase,
  projectRoot: string
): void {
  // Fix stack trace to use source-mapped positions
  server.ssrFixStacktrace(error);

  // Log to stderr with frame dimming
  const formatted = formatTerminalError(error, phase, projectRoot);
  process.stderr.write(`${formatted}\n`);

  // Build overlay payload
  const loc = parseFirstAppFrame(error.stack ?? '', projectRoot);
  const componentStack = extractComponentStack(error);

  let message = error.message;
  if (componentStack) {
    message = `${error.message}\n\nComponent Stack:\n${componentStack.trim()}`;
  }

  // Send to browser via Vite's error overlay protocol
  try {
    server.hot.send({
      type: 'error',
      err: {
        message,
        stack: error.stack ?? '',
        id: loc?.file,
        plugin: `timber (${PHASE_LABELS[phase]})`,
        loc: loc ? { file: loc.file, line: loc.line, column: loc.column } : undefined,
      },
    });
  } catch {
    // Overlay send must never crash the dev server
  }
}
