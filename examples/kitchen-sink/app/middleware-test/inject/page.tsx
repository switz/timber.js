import { headers } from '@timber/app/server';

export default async function InjectPage() {
  const locale = headers().get('X-Locale');
  return (
    <div data-testid="middleware-inject-page">
      <h1 data-testid="middleware-inject-heading">Middleware Inject Test</h1>
      <p data-testid="injected-locale">{locale}</p>
    </div>
  );
}
