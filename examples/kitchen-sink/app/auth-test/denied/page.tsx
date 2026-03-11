export default function DeniedPage() {
  return (
    <div data-testid="auth-denied-page">
      <h1>This page should never render — access.ts calls deny()</h1>
    </div>
  );
}
