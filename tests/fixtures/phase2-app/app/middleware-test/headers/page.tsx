import { headers } from '@timber/app/server';

export default async function HeadersPage() {
  const injected = headers().get('X-Injected');
  return (
    <div data-testid="headers-page">
      <p data-testid="injected-header">{injected}</p>
    </div>
  );
}
