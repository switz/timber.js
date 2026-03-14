import { headers, cookies } from '@timber/app/server';

export default async function CookiesPage() {
  const readCookie = headers().get('X-Read-Cookie');
  const rywCookie = headers().get('X-RYW-Cookie');

  // Verify cookies() read works in server components (read-only context)
  const allCookies = cookies().getAll();

  return (
    <div data-testid="cookies-page">
      <p data-testid="read-cookie">{readCookie}</p>
      <p data-testid="ryw-cookie">{rywCookie}</p>
      <p data-testid="cookie-count">{allCookies.length}</p>
    </div>
  );
}
