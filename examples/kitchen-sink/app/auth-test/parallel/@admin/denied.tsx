export default function AdminDenied() {
  return (
    <div data-testid="admin-denied" className="rounded-lg border border-red-200 bg-red-50 p-3">
      <p data-testid="admin-denied-message" className="text-sm text-red-800">
        Admin access denied
      </p>
      <p className="mt-1 text-xs text-red-600">
        This is <code className="rounded bg-red-100 px-1 py-0.5 font-mono">@admin/denied.tsx</code> — the
        slot gracefully degrades while the rest of the page stays visible.
      </p>
    </div>
  );
}
