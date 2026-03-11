export default async function CatchAllPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div data-testid="catch-all-page">
      <h1 data-testid="catch-all-heading">Catch-All Route</h1>
      <p data-testid="catch-all-value">{slug}</p>
    </div>
  );
}
