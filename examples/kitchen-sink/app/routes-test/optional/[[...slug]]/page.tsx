export default async function OptionalCatchAllPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;

  return (
    <div data-testid="optional-catch-all-page">
      <h1 data-testid="optional-catch-all-heading">Optional Catch-All Route</h1>
      <p data-testid="optional-catch-all-value">{slug ? JSON.stringify(slug) : '(no segments)'}</p>
    </div>
  );
}
