/**
 * Dev logging event types for the structured request tree.
 *
 * The rendering pipeline emits events via a DevLogEmitter.
 * The dev logger subscribes and builds the tree.
 *
 * Design doc: 21-dev-server.md §"Dev Logging", 17-logging.md §"Dev Logging"
 */

// ─── Event Types ────────────────────────────────────────────────────────────

export type DevLogEnvironment = 'rsc' | 'ssr' | 'client' | 'proxy';

export type DevLogEventType =
  | 'request-start'
  | 'request-end'
  | 'phase-start'
  | 'phase-end'
  | 'cache-hit'
  | 'cache-miss'
  | 'access-result'
  | 'suspense-resolve'
  | 'action-start';

export interface DevLogEvent {
  type: DevLogEventType;
  /** Which Vite environment this event belongs to. */
  environment: DevLogEnvironment;
  /** Human-readable label for the phase or component. */
  label: string;
  /** Timestamp in ms since the request started. */
  timestampMs: number;
  /** ID of the parent phase (for nesting). */
  parentId?: string;
  /** Unique ID for this event (used as parentId by children). */
  id: string;
  /** Additional metadata. */
  meta?: Record<string, unknown>;
}

// ─── Emitter ────────────────────────────────────────────────────────────────

type DevLogListener = (event: DevLogEvent) => void;

/**
 * Per-request event emitter for dev logging.
 *
 * Created at request start, collects events during the request lifecycle,
 * and notifies the dev logger subscriber.
 */
export class DevLogEmitter {
  private listeners: DevLogListener[] = [];
  private requestStartMs: number;

  constructor() {
    this.requestStartMs = performance.now();
  }

  /** Subscribe to events. */
  on(listener: DevLogListener): void {
    this.listeners.push(listener);
  }

  /** Emit an event to all listeners. */
  emit(event: Omit<DevLogEvent, 'timestampMs'>): void {
    const fullEvent: DevLogEvent = {
      ...event,
      timestampMs: performance.now() - this.requestStartMs,
    };
    for (const listener of this.listeners) {
      listener(fullEvent);
    }
  }

  /** Get elapsed ms since request start. */
  elapsed(): number {
    return performance.now() - this.requestStartMs;
  }
}
