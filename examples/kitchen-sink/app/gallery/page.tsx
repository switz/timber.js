import { Link } from '@timber-js/app/client';

export const metadata = { title: 'Intercepting Routes: Gallery' };

const photos = [
  { id: '1', label: 'Sunset', color: '#f59e0b' },
  { id: '2', label: 'Mountains', color: '#10b981' },
  { id: '3', label: 'Ocean', color: '#3b82f6' },
];

export default function GalleryPage() {
  return (
    <div data-testid="gallery-page" className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Intercepting Routes</h1>
        <p className="mt-1 text-sm text-stone-500">
          Clicking a photo opens it in a modal overlay via the{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">
            @modal/(.)photo/[id]
          </code>{' '}
          intercepting route. Navigating directly to the URL renders the full page.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {photos.map((photo) => (
          <Link
            key={photo.id}
            href={`/gallery/photo/${photo.id}`}
            data-testid={`gallery-photo-${photo.id}`}
            className="block rounded-lg border border-stone-200 bg-white p-4 text-center shadow-sm hover:border-amber-300 transition-colors"
          >
            <div
              className="mx-auto mb-2 h-16 w-16 rounded"
              style={{ backgroundColor: photo.color }}
            />
            <span className="text-sm font-medium text-stone-700">{photo.label}</span>
          </Link>
        ))}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          <strong>Soft nav</strong> (Link click) → modal overlay via{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">
            @modal/(.)photo/[id]
          </code>
          . <strong>Hard nav</strong> (direct URL) → full page at{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">
            photo/[id]/page.tsx
          </code>
          .
        </p>
      </div>
    </div>
  );
}
