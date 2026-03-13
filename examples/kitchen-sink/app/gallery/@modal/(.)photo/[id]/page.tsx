import { Link } from '@timber/app/client';

const photoData: Record<string, { label: string; color: string }> = {
  '1': { label: 'Sunset', color: '#f59e0b' },
  '2': { label: 'Mountains', color: '#10b981' },
  '3': { label: 'Ocean', color: '#3b82f6' },
};

export default async function PhotoModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = photoData[id] ?? { label: `Photo ${id}`, color: '#6b7280' };

  return (
    <div
      data-testid="photo-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="rounded-xl bg-white p-6 shadow-xl max-w-sm w-full space-y-4">
        <div className="flex items-center justify-between">
          <h2 data-testid="photo-modal-title" className="text-lg font-bold text-stone-900">
            {photo.label}
          </h2>
          <Link
            href="/gallery"
            data-testid="photo-modal-close"
            className="text-stone-400 hover:text-stone-600 text-sm"
          >
            Close
          </Link>
        </div>
        <div
          className="h-48 w-full rounded-lg"
          style={{ backgroundColor: photo.color }}
          data-testid="photo-modal-preview"
        />
        <p className="text-xs text-stone-400">
          This is the <strong>intercepted</strong> modal view. Reload to see the full page.
        </p>
      </div>
    </div>
  );
}
