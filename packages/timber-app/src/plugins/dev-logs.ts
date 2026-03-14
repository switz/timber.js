/**
 * timber-dev-logs — Pipes server console output to the browser console in dev.
 *
 * Patches `console.log/warn/error/debug/info` on the server side and
 * forwards messages to connected browsers via Vite's HMR WebSocket.
 * The browser entry replays them in the browser console with the
 * correct log level and a "[server]" prefix.
 *
 * Dev-only: this plugin only runs during `vite dev` (apply: 'serve').
 * No runtime overhead in production.
 *
 * Design docs: 18-build-system.md §"Dev Server", 02-rendering-pipeline.md
 */

import type { Plugin, ViteDevServer } from 'vite';
import type { PluginContext } from '#/index.js';

// ─── Types ───────────────────────────────────────────────────────────────

/** Log levels that are patched and forwarded. */
export type ServerLogLevel = 'log' | 'warn' | 'error' | 'debug' | 'info';

const LOG_LEVELS: ServerLogLevel[] = ['log', 'warn', 'error', 'debug', 'info'];

/** Payload sent over Vite's HMR WebSocket. */
export interface ServerLogPayload {
  level: ServerLogLevel;
  args: unknown[];
  /** Server-side source location (file:line:col) if available. */
  location: string | null;
  /** Timestamp in ms (Date.now()) */
  timestamp: number;
}

// ─── Serialization ───────────────────────────────────────────────────────

/** Patterns that look like env vars or secrets — these are redacted. */
const SENSITIVE_PATTERNS =
  /(?:^|[^a-z])(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|AUTH|CREDENTIAL|SESSION_SECRET)(?:[^a-z]|$)/i;

/**
 * Serialize a console argument for transmission over WebSocket.
 *
 * Handles: strings, numbers, booleans, null, undefined, arrays, plain
 * objects, Errors, Dates, RegExps, and falls back to String() for others.
 *
 * Redacts values that match sensitive patterns to avoid leaking secrets.
 */
function serializeArg(arg: unknown, depth = 0): unknown {
  if (depth > 5) return '[...]';

  if (arg === null) return null;
  if (arg === undefined) return '[undefined]';

  switch (typeof arg) {
    case 'string':
      if (SENSITIVE_PATTERNS.test(arg)) return '[REDACTED]';
      return arg;
    case 'number':
    case 'boolean':
      return arg;
    case 'bigint':
      return `${arg}n`;
    case 'symbol':
      return arg.toString();
    case 'function':
      return `[Function: ${arg.name || 'anonymous'}]`;
    case 'object':
      break;
    default:
      return String(arg);
  }

  // Error
  if (arg instanceof Error) {
    return {
      __type: 'Error',
      name: arg.name,
      message: arg.message,
      stack: arg.stack ?? null,
    };
  }

  // Date
  if (arg instanceof Date) {
    return arg.toISOString();
  }

  // RegExp
  if (arg instanceof RegExp) {
    return arg.toString();
  }

  // Array
  if (Array.isArray(arg)) {
    return arg.map((item) => serializeArg(item, depth + 1));
  }

  // Map
  if (arg instanceof Map) {
    const entries: Record<string, unknown> = {};
    for (const [key, value] of arg) {
      entries[String(key)] = serializeArg(value, depth + 1);
    }
    return { __type: 'Map', entries };
  }

  // Set
  if (arg instanceof Set) {
    return { __type: 'Set', values: [...arg].map((v) => serializeArg(v, depth + 1)) };
  }

  // Plain object
  if (Object.getPrototypeOf(arg) === Object.prototype || Object.getPrototypeOf(arg) === null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(arg as Record<string, unknown>)) {
      if (SENSITIVE_PATTERNS.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = serializeArg(value, depth + 1);
      }
    }
    return result;
  }

  // Fallback — use toString or constructor name
  try {
    return `[${(arg as object).constructor?.name ?? 'Object'}]`;
  } catch {
    return '[Object]';
  }
}

// ─── Source Location ─────────────────────────────────────────────────────

/**
 * Extract the caller's source location from an Error stack trace.
 *
 * Walks the stack to find the first frame that isn't inside this file
 * or Node internals. Returns "file:line:col" or null.
 */
function extractCallerLocation(projectRoot: string): string | null {
  const err = new Error();
  const stack = err.stack;
  if (!stack) return null;

  const lines = stack.split('\n');
  // Skip first line ("Error") and frames inside this module
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip our own patching frames
    if (line.includes('dev-logs')) continue;
    // Skip node internals
    if (line.includes('node:') || line.includes('node_modules')) continue;

    // Extract file path from "at ... (file:line:col)" or "at file:line:col"
    const match = line.match(/\((.+?):(\d+):(\d+)\)/) ?? line.match(/at (.+?):(\d+):(\d+)/);
    if (match) {
      let filePath = match[1];
      // Make path relative to project root for readability
      if (filePath.startsWith(projectRoot)) {
        filePath = filePath.slice(projectRoot.length + 1);
      }
      return `${filePath}:${match[2]}:${match[3]}`;
    }
  }
  return null;
}

// ─── Framework-Internal Detection ────────────────────────────────────────

/**
 * Check if the calling code is from timber's internal plugin/adapter plumbing.
 *
 * Only filters logs from `plugins/` and `adapters/` directories — these are
 * framework operational noise (request summaries, codegen warnings, adapter
 * setup). Logs from `server/` are preserved because they surface user errors
 * (render errors, action errors, route handler errors, etc.).
 *
 * Handles both monorepo paths (timber-app/src/plugins/) and installed
 * package paths (@timber/app/dist/plugins/).
 */
export function isFrameworkInternalCaller(): boolean {
  const err = new Error();
  const stack = err.stack;
  if (!stack) return false;

  const lines = stack.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip our own patching frames
    if (line.includes('dev-logs')) continue;
    // Skip node internals (but NOT node_modules — we need to inspect those)
    if (line.includes('node:')) continue;

    // Check if this first real frame is inside timber's own source
    const isTimberPath = line.includes('timber-app/') || line.includes('@timber/app/');
    if (!isTimberPath) return false;

    // Only filter plugin and adapter internals, not server/ runtime code
    // which surfaces user errors (render errors, action errors, etc.)
    return line.includes('/plugins/') || line.includes('/adapters/');
  }
  return false;
}

// ─── Console Patching ────────────────────────────────────────────────────

/**
 * Patch console methods to forward logs to the browser via HMR WebSocket.
 *
 * Each patched method:
 * 1. Calls the original console method (server terminal still works)
 * 2. Serializes arguments for JSON transport
 * 3. Sends via server.hot.send() — dropped if no clients connected
 */
function patchConsole(server: ViteDevServer, projectRoot: string): () => void {
  const originals = new Map<ServerLogLevel, (...args: unknown[]) => void>();

  for (const level of LOG_LEVELS) {
    originals.set(level, console[level].bind(console));

    console[level] = (...args: unknown[]) => {
      // Always call the original — server terminal output is preserved
      originals.get(level)!(...args);

      // Skip framework-internal logs (plugins/, adapters/) from browser forwarding.
      // Server runtime logs (render errors, action errors, etc.) are preserved.
      if (isFrameworkInternalCaller()) return;

      // Serialize and forward to browser
      try {
        const payload: ServerLogPayload = {
          level,
          args: args.map((arg) => serializeArg(arg)),
          location: extractCallerLocation(projectRoot),
          timestamp: Date.now(),
        };

        server.hot.send('timber:server-log', payload);
      } catch {
        // Never let log forwarding break the server
      }
    };
  }

  // Return a cleanup function to restore originals
  return () => {
    for (const [level, original] of originals) {
      console[level] = original;
    }
  };
}

// ─── Plugin ──────────────────────────────────────────────────────────────

/**
 * Create the timber-dev-logs Vite plugin.
 *
 * Patches console methods when the dev server starts and restores them
 * when the server closes. Only active during `vite dev`.
 */
export function timberDevLogs(_ctx: PluginContext): Plugin {
  let cleanup: (() => void) | null = null;

  return {
    name: 'timber-dev-logs',
    apply: 'serve',

    configureServer(server: ViteDevServer) {
      cleanup = patchConsole(server, _ctx.root);

      // Restore console on server close
      server.httpServer?.on('close', () => {
        cleanup?.();
        cleanup = null;
      });
    },
  };
}
