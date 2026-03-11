export default function Deny401Page() {
  return (
    <div data-testid="deny-401-page">
      <h1>This page should never render — access.ts calls deny(401)</h1>
    </div>
  );
}
