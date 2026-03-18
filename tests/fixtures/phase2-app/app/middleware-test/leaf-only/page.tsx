import { headers } from '@timber-js/app/server';

export default async function LeafOnlyParentPage() {
  const parentMiddleware = headers().get('X-Parent-Middleware');
  return (
    <div data-testid="leaf-only-parent-page">
      <p data-testid="parent-middleware-value">{parentMiddleware ?? 'not-set'}</p>
    </div>
  );
}
