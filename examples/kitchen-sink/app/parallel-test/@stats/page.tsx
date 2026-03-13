export default function StatsSlot() {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xs font-medium text-stone-400 mb-1">@stats slot</div>
      <div data-testid="stats-content" className="space-y-2 text-sm text-stone-800">
        <div className="flex justify-between">
          <span>Users</span>
          <span className="font-mono font-medium">1,234</span>
        </div>
        <div className="flex justify-between">
          <span>Requests</span>
          <span className="font-mono font-medium">56,789</span>
        </div>
      </div>
    </div>
  );
}
