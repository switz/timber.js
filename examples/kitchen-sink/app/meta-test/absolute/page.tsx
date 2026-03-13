import type { Metadata } from '@timber/app/server';

export const metadata: Metadata = {
  title: { absolute: 'Absolute Title' },
  description: 'Testing title.absolute skips template',
};

export default function AbsoluteTitlePage() {
  return (
    <div data-testid="meta-absolute-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="meta-absolute-heading" className="text-2xl font-bold text-stone-900">
          Absolute Title Test
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Uses <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">title: &#123; absolute: &apos;...&apos; &#125;</code> to
          skip the layout&apos;s template.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">Expected document.title</div>
        <div className="text-lg font-semibold text-stone-800">Absolute Title</div>
        <div className="mt-1 text-xs text-stone-400">
          Not &ldquo;Absolute Title | Kitchen Sink&rdquo; — the template is bypassed.
        </div>
      </div>
    </div>
  );
}
