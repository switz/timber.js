import { Link } from '@timber/app/client';

const photoData: Record<string, { label: string; color: string }> = {
  '1': { label: 'Sunset', color: '#f59e0b' },
  '2': { label: 'Mountains', color: '#10b981' },
  '3': { label: 'Ocean', color: '#3b82f6' },
};

export default async function PhotoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = photoData[id] ?? { label: `Photo ${id}`, color: '#6b7280' };

  return (
    <div data-testid="photo-full-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="photo-full-title" className="text-2xl font-bold text-stone-900">
          {photo.label}
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Full photo page — this renders on hard navigation (direct URL).
        </p>
      </div>

      <div
        className="h-64 w-full rounded-lg"
        style={{ backgroundColor: photo.color }}
        data-testid="photo-full-preview"
      />

      <Link
        href="/gallery"
        data-testid="photo-back-link"
        className="inline-block text-sm text-amber-700 hover:text-amber-900 hover:underline"
      >
        ← Back to gallery
      </Link>
    </div>
  );
}
