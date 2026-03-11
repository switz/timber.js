export default function NestedChildPage() {
  return (
    <div data-testid="nested-child-page">
      <h1>This page should never render — child access.ts calls deny()</h1>
    </div>
  );
}
