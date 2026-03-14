'use client';

/**
 * Framework-injected React error boundary.
 *
 * Catches errors thrown by children and renders a fallback component
 * with the appropriate props based on error type:
 *   - DenySignal (4xx) → { status, dangerouslyPassData }
 *   - RenderError (5xx) → { error, digest, reset }
 *   - Unhandled error → { error, digest: null, reset }
 *
 * The `status` prop controls which errors this boundary catches:
 *   - Specific code (e.g. 403) → only that status
 *   - Category (400) → any 4xx
 *   - Category (500) → any 5xx
 *   - Omitted → catches everything (error.tsx behavior)
 *
 * See design/10-error-handling.md §"Status-Code Files"
 */

import { Component, createElement, type ReactNode } from 'react';

// ─── Page Unload Detection ───────────────────────────────────────────────────
// Track whether the page is being unloaded (user refreshed or navigated away).
// When this is true, error boundaries suppress activation — the error is from
// the aborted connection, not an application error.
let _isUnloading = false;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    _isUnloading = true;
  });
  window.addEventListener('pagehide', () => {
    _isUnloading = true;
  });
}

// ─── Digest Types ────────────────────────────────────────────────────────────

/** Structured digest returned by RSC onError for DenySignal. */
interface DenyDigest {
  type: 'deny';
  status: number;
  data: unknown;
}

/** Structured digest returned by RSC onError for RenderError. */
interface RenderErrorDigest {
  type: 'render-error';
  code: string;
  data: unknown;
  status: number;
}

/** Structured digest returned by RSC onError for RedirectSignal. */
interface RedirectDigest {
  type: 'redirect';
  location: string;
  status: number;
}

type ParsedDigest = DenyDigest | RenderErrorDigest | RedirectDigest;

// ─── Props & State ───────────────────────────────────────────────────────────

export interface TimberErrorBoundaryProps {
  /** The component to render when an error is caught. */
  fallbackComponent: (...args: unknown[]) => ReactNode;
  /**
   * Status code filter. If set, only catches errors matching this status.
   * 400 = any 4xx, 500 = any 5xx, specific number = exact match.
   */
  status?: number;
  children: ReactNode;
}

interface TimberErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export class TimberErrorBoundary extends Component<
  TimberErrorBoundaryProps,
  TimberErrorBoundaryState
> {
  constructor(props: TimberErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): TimberErrorBoundaryState {
    // Suppress error boundaries during page unload (refresh/navigate away).
    // The aborted connection causes React's streaming hydration to error,
    // but the page is about to be replaced — showing an error boundary
    // would be a jarring flash for the user.
    if (_isUnloading) {
      return { hasError: false, error: null };
    }
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: TimberErrorBoundaryProps): void {
    // Reset error state when children change (e.g. client-side navigation).
    // Without this, navigating from one error page to another keeps the
    // stale error — getDerivedStateFromError doesn't re-fire for new children.
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false, error: null });
    }
  }

  /** Reset the error state so children re-render. */
  private reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError || !this.state.error) {
      return this.props.children;
    }

    const error = this.state.error;
    const parsed = parseDigest(error);

    // RedirectSignal errors must propagate through all error boundaries
    // so the SSR shell fails and the pipeline catch block can produce a
    // proper HTTP redirect response. See design/04-authorization.md.
    if (parsed?.type === 'redirect') {
      throw error;
    }

    // If this boundary has a status filter, check whether the error matches.
    // Non-matching errors re-throw so an outer boundary can catch them.
    if (this.props.status != null) {
      const errorStatus = getErrorStatus(parsed, error);
      if (errorStatus == null || !statusMatches(this.props.status, errorStatus)) {
        // Re-throw: this boundary doesn't handle this error.
        throw error;
      }
    }

    // Render the fallback component with the right props shape.
    if (parsed?.type === 'deny') {
      return createElement(this.props.fallbackComponent as never, {
        status: parsed.status,
        dangerouslyPassData: parsed.data,
      });
    }

    // 5xx / RenderError / unhandled error
    const digest =
      parsed?.type === 'render-error' ? { code: parsed.code, data: parsed.data } : null;

    return createElement(this.props.fallbackComponent as never, {
      error,
      digest,
      reset: this.reset,
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse the structured digest from the error.
 * React sets `error.digest` from the string returned by RSC's onError.
 */
function parseDigest(error: Error): ParsedDigest | null {
  const raw = (error as { digest?: string }).digest;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed as ParsedDigest;
    }
  } catch {
    // Not JSON — legacy or unknown digest format
  }
  return null;
}

/**
 * Extract the HTTP status code from a parsed digest or error message.
 * Falls back to message pattern matching for errors without a digest.
 */
function getErrorStatus(parsed: ParsedDigest | null, error: Error): number | null {
  if (parsed?.type === 'deny') return parsed.status;
  if (parsed?.type === 'render-error') return parsed.status;
  if (parsed?.type === 'redirect') return parsed.status;

  // Fallback: parse DenySignal message pattern for errors that lost their digest
  const match = error.message.match(/^Access denied with status (\d+)$/);
  if (match) return parseInt(match[1], 10);

  // Unhandled errors are implicitly 500
  return 500;
}

/**
 * Check whether an error's status matches the boundary's status filter.
 * Category markers (400, 500) match any status in that range.
 */
function statusMatches(boundaryStatus: number, errorStatus: number): boolean {
  // Category catch-all: 400 matches any 4xx, 500 matches any 5xx
  if (boundaryStatus === 400) return errorStatus >= 400 && errorStatus <= 499;
  if (boundaryStatus === 500) return errorStatus >= 500 && errorStatus <= 599;
  // Exact match
  return boundaryStatus === errorStatus;
}
