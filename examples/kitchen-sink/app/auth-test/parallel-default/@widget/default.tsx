export default function WidgetDefault() {
  return (
    <div
      data-testid="widget-default"
      className="rounded-lg border border-stone-200 bg-stone-50 p-3"
    >
      <p data-testid="widget-default-message" className="text-sm text-stone-600">
        Widget default fallback
      </p>
      <p className="mt-1 text-xs text-stone-400">
        This is{' '}
        <code className="rounded bg-stone-100 px-1 py-0.5 font-mono">@widget/default.tsx</code> —
        shown because denied.tsx doesn&apos;t exist for this slot.
      </p>
    </div>
  );
}
