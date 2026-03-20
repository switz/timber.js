/**
 * Dev-only browser helpers — server log replay and client error forwarding.
 *
 * These are only active when import.meta.hot is available (Vite dev mode).
 * Extracted from browser-entry.ts to keep files under 500 lines.
 *
 * See design/21-dev-server.md §"HMR Wiring"
 */

import { isPageUnloading } from './unload-guard.js';

// ─── HMR Hot Interface ──────────────────────────────────────────────

/** Minimal interface for Vite's HMR channel. */
export interface HotInterface {
  on(event: string, cb: (...args: unknown[]) => void): void;
  send(event: string, data: unknown): void;
}

// ─── Server Log Replay ──────────────────────────────────────────────

/** Payload shape from plugins/dev-logs.ts */
interface ServerLogPayload {
  level: 'log' | 'warn' | 'error' | 'debug' | 'info';
  args: unknown[];
  location: string | null;
  timestamp: number;
}

/**
 * Deserialize a serialized arg back into a console-friendly value.
 *
 * Handles Error objects (serialized as { __type: 'Error', ... }),
 * Maps, Sets, and passes everything else through.
 */
function deserializeArg(arg: unknown): unknown {
  if (arg === '[undefined]') return undefined;
  if (arg === null || typeof arg !== 'object') return arg;

  const obj = arg as Record<string, unknown>;

  if (obj.__type === 'Error') {
    const err = new Error(obj.message as string);
    err.name = obj.name as string;
    if (obj.stack) err.stack = obj.stack as string;
    return err;
  }

  if (obj.__type === 'Map') {
    return new Map(
      Object.entries(obj.entries as Record<string, unknown>).map(([k, v]) => [k, deserializeArg(v)])
    );
  }

  if (obj.__type === 'Set') {
    return new Set((obj.values as unknown[]).map(deserializeArg));
  }

  if (Array.isArray(arg)) {
    return arg.map(deserializeArg);
  }

  // Plain object — recurse
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = deserializeArg(value);
  }
  return result;
}

/**
 * Set up the HMR listener that replays server console output in the browser.
 *
 * Each message arrives with a log level and serialized args. We prepend
 * a styled "[SERVER]" badge and call the matching console method.
 */
export function setupServerLogReplay(hot: Pick<HotInterface, 'on'>): void {
  /** CSS styles for the [SERVER] badge in browser console. */
  const BADGE_STYLES: Record<string, string> = {
    log: 'background: #0070f3; color: white; padding: 1px 5px; border-radius: 3px; font-weight: bold;',
    info: 'background: #0070f3; color: white; padding: 1px 5px; border-radius: 3px; font-weight: bold;',
    warn: 'background: #f5a623; color: white; padding: 1px 5px; border-radius: 3px; font-weight: bold;',
    error:
      'background: #e00; color: white; padding: 1px 5px; border-radius: 3px; font-weight: bold;',
    debug:
      'background: #666; color: white; padding: 1px 5px; border-radius: 3px; font-weight: bold;',
  };

  hot.on('timber:server-log', (data: unknown) => {
    const payload = data as ServerLogPayload;
    const level = payload.level;
    const fn = console[level] ?? console.log;
    const args = payload.args.map(deserializeArg);

    const badge = `%cSERVER`;
    const style = BADGE_STYLES[level] ?? BADGE_STYLES.log;
    const locationSuffix = payload.location ? ` (${payload.location})` : '';

    fn.call(console, badge, style, ...args, locationSuffix ? `\n  → ${payload.location}` : '');
  });
}

// ─── Client Error Forwarding ────────────────────────────────────────

/**
 * Set up global error handlers that forward uncaught client-side
 * errors to the dev server via Vite's HMR channel.
 *
 * The server receives 'timber:client-error' events, and echoes them
 * back as Vite '{ type: "error" }' payloads to trigger the overlay.
 */
export function setupClientErrorForwarding(hot: Pick<HotInterface, 'send'>): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    // Skip errors without useful information
    if (!event.error && !event.message) return;
    // Skip errors during page unload — these are abort-related, not application errors
    if (isPageUnloading()) return;

    const error = event.error;
    hot.send('timber:client-error', {
      message: error?.message ?? event.message,
      stack: error?.stack ?? '',
      componentStack: error?.componentStack ?? null,
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (!reason) return;
    // Skip rejections during page unload — aborted fetches/streams cause these
    if (isPageUnloading()) return;

    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? (reason.stack ?? '') : '';

    hot.send('timber:client-error', {
      message,
      stack,
      componentStack: null,
    });
  });
}
