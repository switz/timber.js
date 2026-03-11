export default function Deny404Page() {
  return (
    <div data-testid="deny-404-page">
      <h1>This page should never render — access.ts calls deny(404)</h1>
    </div>
  );
}
