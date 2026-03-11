'use client';

// Root error boundary — catches unhandled render errors and 4xx denials
// that fall through status-code files.
//
// Per design/10-error-handling.md:
// - For 5xx/unhandled errors: receives { error, digest, reset }
// - For 4xx denials (when no status-code file matches): receives { status, dangerouslyPassData }
// - digest is null when the error is not a RenderError
export default function ErrorBoundary(props: {
  error?: Error;
  digest?: { code: string; data: Record<string, unknown> } | null;
  reset?: () => void;
  status?: number;
  dangerouslyPassData?: unknown;
}) {
  // 4xx denial fallback — error.tsx is the last resort for unmatched deny() calls
  if (props.status && props.status >= 400 && props.status < 500) {
    return (
      <div data-testid="denial-fallback">
        <h1 data-testid="denial-heading">{props.status} — Access Denied (fallback)okay,</h1>
        <p data-testid="denial-status">Status: {props.status}</p>
        {props.dangerouslyPassData != null && (
          <pre data-testid="denial-data">{JSON.stringify(props.dangerouslyPassData)}</pre>
        )}
      </div>
    );
  }

  // 5xx / unhandled error
  return (
    <div data-testid="error-boundary">
      <h1 data-testid="error-heading">Something went wrong</h1>
      <p data-testid="error-message">{props.error?.message ?? 'Unknown error'}</p>
      {props.digest && (
        <div data-testid="error-digest">
          <p data-testid="error-digest-code">{props.digest.code}</p>
          <pre data-testid="error-digest-data">{JSON.stringify(props.digest.data)}</pre>
        </div>
      )}
      {props.reset && (
        <button data-testid="error-reset" onClick={props.reset}>
          Try again
        </button>
      )}
    </div>
  );
}
