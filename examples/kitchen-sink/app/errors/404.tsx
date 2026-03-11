'use client';

// Segment-level 404 page — renders when deny(404) is called in this segment.
// Per design/10-error-handling.md, 4xx files receive { status, dangerouslyPassData }.
export default function SegmentNotFound({
  status,
  dangerouslyPassData,
}: {
  status: number;
  dangerouslyPassData?: unknown;
}) {
  return (
    <div data-testid="segment-not-found-page">
      <h1 data-testid="segment-not-found-heading">404 — Not Found (Segment)</h1>
      <p data-testid="segment-not-found-status">Status: {status}</p>
      {dangerouslyPassData != null && (
        <pre data-testid="segment-not-found-data">{JSON.stringify(dangerouslyPassData)}</pre>
      )}
    </div>
  );
}
