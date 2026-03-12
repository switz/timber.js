import { headers } from '@timber/app/server';

export default async function CookiesPage() {
  const readCookie = headers().get('X-Read-Cookie');
  return (
    <div data-testid="cookies-page">
      <p data-testid="read-cookie">{readCookie}</p>
    </div>
  );
}
