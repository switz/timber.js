import { headers } from '@timber/app/server';

export default async function NavTargetPage() {
  const timestamp = headers().get('X-Nav-Timestamp');
  return (
    <div data-testid="middleware-nav-target-page">
      <h1 data-testid="nav-target-heading">Nav Target</h1>
      <p data-testid="nav-timestamp">{timestamp}</p>
    </div>
  );
}
