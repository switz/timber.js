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
      <div data-testid="denial-fallback" className="max-w-lg space-y-4">
        <div>
          <h1 data-testid="denial-heading" className="text-2xl font-bold text-stone-900">
            {props.status} — Access Denied
          </h1>
          <p data-testid="denial-status" className="mt-1 text-sm text-stone-500">
            Status: {props.status}
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            No specific status-code file ({props.status}.tsx) matched this denial. This is the root{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">error.tsx</code>{' '}
            fallback.
          </p>
        </div>
        {props.dangerouslyPassData != null && (
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-xs font-medium text-stone-400 mb-1">dangerouslyPassData</div>
            <pre
              data-testid="denial-data"
              className="text-sm font-mono text-stone-700 overflow-x-auto"
            >
              {JSON.stringify(props.dangerouslyPassData, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // 5xx / unhandled error
  return (
    <div data-testid="error-boundary" className="max-w-lg space-y-4">
      <div>
        <h1 data-testid="error-heading" className="text-2xl font-bold text-stone-900">
          Something went wrong
        </h1>
        <p data-testid="error-message" className="mt-1 text-sm text-stone-500">
          {props.error?.message ?? 'Unknown error'}
        </p>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          This is the root{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">error.tsx</code>{' '}
          boundary. timber.js returned a real HTTP 500 — check the browser&apos;s network tab.
        </p>
      </div>
      {props.digest && (
        <div
          data-testid="error-digest"
          className="rounded-lg border border-stone-200 bg-white p-4 space-y-2"
        >
          <div className="text-xs font-medium text-stone-400">RenderError digest</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-stone-400">code</div>
              <div
                data-testid="error-digest-code"
                className="text-sm font-mono font-semibold text-stone-800"
              >
                {props.digest.code}
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-400">data</div>
              <pre data-testid="error-digest-data" className="text-sm font-mono text-stone-700">
                {JSON.stringify(props.digest.data)}
              </pre>
            </div>
          </div>
        </div>
      )}
      {props.reset && (
        <button
          data-testid="error-reset"
          onClick={props.reset}
          className="inline-flex items-center rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
