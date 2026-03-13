export default function ActivitySlot() {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xs font-medium text-stone-400 mb-1">@activity slot</div>
      <ul data-testid="activity-content" className="space-y-1 text-sm text-stone-800">
        <li>User signed up</li>
        <li>Deployment completed</li>
        <li>Cache invalidated</li>
      </ul>
    </div>
  );
}
