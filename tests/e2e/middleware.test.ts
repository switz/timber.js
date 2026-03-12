/**
 * E2E tests for middleware.ts behavior.
 *
 * Tests the one-arg MiddlewareContext signature, leaf-only execution,
 * header manipulation, short-circuiting, redirects, error handling,
 * cookie handling, API route middleware, and params resolution.
 *
 * See design/07-routing.md §"middleware.ts"
 */
import { test, expect } from '@playwright/test';

// ─── Response Header Manipulation ──────────────────────────────────────────

test.describe('middleware response headers', () => {
  test('middleware sets response headers visible in HTTP response', async ({ request }) => {
    const response = await request.get('/middleware-test/headers');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-custom-header']).toBe('middleware-value');
    expect(response.headers()['cache-control']).toBe('private, max-age=0');
  });

  test('middleware injects request headers readable via headers()', async ({ page }) => {
    await page.goto('/middleware-test/headers');
    const injected = page.locator('[data-testid="injected-header"]');
    await expect(injected).toHaveText('from-middleware');
  });
});

// ─── Short-Circuit ─────────────────────────────────────────────────────────

test.describe('middleware short-circuit', () => {
  test('middleware returning Response short-circuits rendering', async ({ request }) => {
    const response = await request.get('/middleware-test/short-circuit');
    expect(response.status()).toBe(403);
    expect(await response.text()).toBe('Forbidden by middleware');
  });

  test('page content is not rendered when middleware short-circuits', async ({ request }) => {
    const response = await request.get('/middleware-test/short-circuit');
    const body = await response.text();
    expect(body).not.toContain('This should never render');
  });
});

// ─── Redirect ──────────────────────────────────────────────────────────────

test.describe('middleware redirect', () => {
  test('middleware can redirect based on query params', async ({ request }) => {
    const response = await request.get('/middleware-test/redirect?redirect=true', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toContain('/');
  });

  test('middleware does not redirect without trigger', async ({ request }) => {
    const response = await request.get('/middleware-test/redirect');
    expect(response.status()).toBe(200);
  });

  test('browser follows middleware redirect', async ({ page }) => {
    await page.goto('/middleware-test/redirect?redirect=true');
    await expect(page).toHaveURL('/');
  });
});

// ─── Error Handling ────────────────────────────────────────────────────────

test.describe('middleware error handling', () => {
  test('middleware throw produces HTTP 500', async ({ request }) => {
    const response = await request.get('/middleware-test/error');
    expect(response.status()).toBe(500);
  });

  test('page content is not rendered when middleware throws', async ({ request }) => {
    const response = await request.get('/middleware-test/error');
    const body = await response.text();
    expect(body).not.toContain('This should never render');
  });

  test('error message is not leaked in response body', async ({ request }) => {
    const response = await request.get('/middleware-test/error');
    const body = await response.text();
    expect(body).not.toContain('Middleware intentional error');
  });
});

// ─── Cookie Handling ───────────────────────────────────────────────────────

test.describe('middleware cookie handling', () => {
  test('middleware reads cookies from request', async ({ page, context }) => {
    await context.addCookies([{
      name: 'test-cookie',
      value: 'hello-from-test',
      url: 'http://localhost:3000',
    }]);
    await page.goto('/middleware-test/cookies');
    const readCookie = page.locator('[data-testid="read-cookie"]');
    await expect(readCookie).toHaveText('hello-from-test');
  });

  test('middleware sets response cookies', async ({ request }) => {
    const response = await request.get('/middleware-test/cookies');
    expect(response.status()).toBe(200);
    const setCookie = response.headers()['set-cookie'];
    expect(setCookie).toContain('middleware-cookie=set-by-middleware');
  });

  test('middleware reports no cookie when none sent', async ({ page }) => {
    await page.goto('/middleware-test/cookies');
    const readCookie = page.locator('[data-testid="read-cookie"]');
    await expect(readCookie).toHaveText('none');
  });
});

// ─── API Route Middleware ──────────────────────────────────────────────────

test.describe('middleware on API routes', () => {
  test('middleware runs before API handler (GET)', async ({ request }) => {
    const response = await request.get('/middleware-test/api');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-api-middleware']).toBe('ran');
    const json = await response.json();
    expect(json).toEqual({ message: 'api-ok', method: 'GET' });
  });

  test('middleware runs before API handler (POST)', async ({ request }) => {
    const response = await request.post('/middleware-test/api', {
      data: JSON.stringify({ test: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status()).toBe(201);
    expect(response.headers()['x-api-middleware']).toBe('ran');
    const json = await response.json();
    expect(json).toEqual({ message: 'api-ok', method: 'POST' });
  });

  test('middleware can short-circuit API routes', async ({ request }) => {
    const response = await request.get('/middleware-test/api', {
      headers: { 'X-Block-Api': 'true' },
    });
    expect(response.status()).toBe(401);
    const json = await response.json();
    expect(json).toEqual({ error: 'blocked' });
  });
});

// ─── Params Resolution ────────────────────────────────────────────────────

test.describe('middleware params resolution', () => {
  test('ctx.params is fully resolved when middleware runs', async ({ request }) => {
    const response = await request.get('/middleware-test/params/test-slug');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-slug-from-middleware']).toBe('test-slug');
  });

  test('params injected via requestHeaders are visible to page', async ({ page }) => {
    await page.goto('/middleware-test/params/hello-world');
    const slug = page.locator('[data-testid="slug-value"]');
    await expect(slug).toHaveText('hello-world');
  });
});

// ─── Leaf-Only Execution ───────────────────────────────────────────────────

test.describe('middleware leaf-only execution', () => {
  test('parent middleware runs when parent route is the leaf', async ({ request }) => {
    const response = await request.get('/middleware-test/leaf-only');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-parent-middleware']).toBe('ran');
  });

  test('only leaf middleware runs for nested routes — parent middleware does NOT run', async ({
    request,
  }) => {
    const response = await request.get('/middleware-test/leaf-only/nested');
    expect(response.status()).toBe(200);
    // Nested (leaf) middleware should have run
    expect(response.headers()['x-nested-middleware']).toBe('ran');
    // Parent middleware should NOT have run — leaf-only design
    expect(response.headers()['x-parent-middleware']).toBeUndefined();
  });

  test('page confirms only leaf middleware injected request headers', async ({ page }) => {
    await page.goto('/middleware-test/leaf-only/nested');
    const parent = page.locator('[data-testid="parent-middleware-value"]');
    const nested = page.locator('[data-testid="nested-middleware-value"]');
    await expect(parent).toHaveText('not-set');
    await expect(nested).toHaveText('ran');
  });
});
