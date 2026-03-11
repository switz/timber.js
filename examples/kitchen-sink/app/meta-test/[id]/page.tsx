import type { Metadata } from '@timber/app/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Item ${id}`,
    description: `Dynamic metadata for item ${id}`,
  };
}

export default async function DynamicMetaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div data-testid="meta-dynamic-page">
      <h1 data-testid="meta-dynamic-heading">Dynamic Metadata</h1>
      <p data-testid="meta-dynamic-id">{id}</p>
    </div>
  );
}
