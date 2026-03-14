import { headers } from '@timber/app/server';

export default async function NavTargetPage() {
  const timestamp = headers().get('X-Nav-Timestamp');
  return (
    <div data-testid="middleware-nav-target-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="nav-target-heading" className="text-2xl font-bold text-stone-900">
          Middleware: Nav Target
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Middleware injects a timestamp on every request — verifying middleware re-runs on client
          navigation.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">X-Nav-Timestamp</div>
        <div
          data-testid="nav-timestamp"
          className="text-lg font-mono font-semibold tabular-nums text-stone-800"
        >
          {timestamp}
        </div>
      </div>
    </div>
  );
}
