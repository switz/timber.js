'use client';

// Segment-level 403 page — renders when deny(403) is called in this segment.
// Per design/10-error-handling.md, 4xx files receive { status, dangerouslyPassData }.
export default function Forbidden({
  status,
  dangerouslyPassData,
}: {
  status: number;
  dangerouslyPassData?: unknown;
}) {
  return (
    <div data-testid="forbidden-page" className="max-w-lg space-y-4">
      <div>
        <h1 data-testid="forbidden-heading" className="text-2xl font-bold text-stone-900">
          403 — Forbidden
        </h1>
        <p data-testid="forbidden-status" className="mt-1 text-sm text-stone-500">
          Status: {status}
        </p>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          This is <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">errors/403.tsx</code> —
          a segment-level status-code file. timber.js returned a real HTTP 403.
        </p>
      </div>
      {dangerouslyPassData != null && (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs font-medium text-stone-400 mb-1">dangerouslyPassData</div>
          <pre data-testid="forbidden-data" className="text-sm font-mono text-stone-700 overflow-x-auto">
            {JSON.stringify(dangerouslyPassData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
