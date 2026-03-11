'use client';

// Status-code file with shell opt-out.
// Renders without root/segment layouts when deny(401) is called in this segment.
// The component is responsible for its own HTML structure.
// See design/10-error-handling.md §"Shell Opt-Out"
export const shell = false;

export default function Unauthorized({ status }: { status: number }) {
  return (
    <div data-testid="no-shell-401">
      <h1>401 — Unauthorized (No Shell)</h1>
      <p>Status: {status}</p>
      <p>This page renders without the app shell (no layouts wrapping it).</p>
    </div>
  );
}
