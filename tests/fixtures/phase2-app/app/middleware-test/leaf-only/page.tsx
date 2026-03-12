import { headers } from '@timber/app/server';

export default async function LeafOnlyParentPage() {
  const parentMiddleware = headers().get('X-Parent-Middleware');
  return (
    <div data-testid="leaf-only-parent-page">
      <p data-testid="parent-middleware-value">{parentMiddleware ?? 'not-set'}</p>
    </div>
  );
}
