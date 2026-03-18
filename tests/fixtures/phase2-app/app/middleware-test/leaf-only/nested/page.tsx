import { headers } from '@timber-js/app/server';

export default async function NestedPage() {
  const parentMiddleware = headers().get('X-Parent-Middleware');
  const nestedMiddleware = headers().get('X-Nested-Middleware');
  return (
    <div data-testid="nested-page">
      <p data-testid="parent-middleware-value">{parentMiddleware ?? 'not-set'}</p>
      <p data-testid="nested-middleware-value">{nestedMiddleware ?? 'not-set'}</p>
    </div>
  );
}
