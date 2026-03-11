export default async function DynamicIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div data-testid="dynamic-id-page">
      <h1 data-testid="dynamic-id-heading">Dynamic Route</h1>
      <p data-testid="dynamic-id-value">{id}</p>
    </div>
  );
}
