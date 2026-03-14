export const metadata = { title: 'Parallel Routes: Dashboard' };

export default function DashboardPage() {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xs font-medium text-stone-400 mb-1">children slot</div>
      <p data-testid="parallel-main-content" className="text-sm text-stone-800">
        This is the main content (children). The stats and activity panels below are independent
        parallel slots.
      </p>
    </div>
  );
}
