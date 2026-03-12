import { headers } from '@timber/app/server';

export default async function ParamsPage() {
  const slug = headers().get('X-Slug-Param');
  return (
    <div data-testid="params-page">
      <p data-testid="slug-value">{slug}</p>
    </div>
  );
}
