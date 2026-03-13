import { headers } from '@timber/app/server';

export default async function InjectPage() {
  const locale = headers().get('X-Locale');
  return (
    <div data-testid="middleware-inject-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="middleware-inject-heading" className="text-2xl font-bold text-stone-900">
          Middleware: Header Injection
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Middleware injects an <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">X-Locale</code> request
          header that server components can read via <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">headers()</code>.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">Injected locale</div>
        <div data-testid="injected-locale" className="text-2xl font-semibold text-stone-800">
          {locale}
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          The original request has no X-Locale header. Middleware adds it via{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">ctx.requestHeaders.set()</code>,
          and the server component reads it with <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">headers().get(&apos;X-Locale&apos;)</code>.
        </p>
      </div>
    </div>
  );
}
