export default async function HeadersPage() {
  // These headers are set by middleware.ts in this segment.
  return (
    <div data-testid="middleware-headers-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="middleware-headers-heading" className="text-2xl font-bold text-stone-900">
          Middleware: Response Headers
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          This route&apos;s middleware.ts sets custom response headers before rendering starts.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-2">
        <div className="text-xs font-medium text-stone-400">Headers set by middleware</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="font-mono text-stone-500">Cache-Control</div>
          <div className="font-mono text-stone-800">no-store</div>
          <div className="font-mono text-stone-500">X-Test</div>
          <div data-testid="header-x-test" className="font-mono text-stone-800">
            from-middleware
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          Check the network tab or run{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">
            curl -I http://localhost:3003/middleware-test/headers
          </code>{' '}
          to see the headers.
        </p>
      </div>
    </div>
  );
}
