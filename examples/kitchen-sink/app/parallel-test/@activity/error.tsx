'use client';

export default function ActivityError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div data-testid="activity-error" className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="text-xs font-medium text-red-400 mb-1">@activity error boundary</div>
      <p className="text-sm text-red-700 mb-2">{error.message}</p>
      <button onClick={reset} className="text-xs text-red-600 underline">
        Retry
      </button>
    </div>
  );
}
