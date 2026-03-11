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
    <div data-testid="forbidden-page">
      <h1 data-testid="forbidden-heading">403 — Forbidden</h1>
      <p data-testid="forbidden-status">Status: {status}</p>
      {dangerouslyPassData != null && (
        <pre data-testid="forbidden-data">{JSON.stringify(dangerouslyPassData)}</pre>
      )}
    </div>
  );
}
