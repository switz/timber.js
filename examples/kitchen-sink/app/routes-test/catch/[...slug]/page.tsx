export default async function CatchAllPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return (
    <div data-testid="catch-all-page">
      <h1 data-testid="catch-all-heading">Catch-All Route</h1>
      <pre data-testid="catch-all-value">{JSON.stringify(slug)}</pre>
    </div>
  );
}
