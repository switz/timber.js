/**
 * E2E tests for access.ts authorization behavior.
 *
 * Validates:
 * - Segment access deny() produces correct HTTP status codes (403, 401, 404)
 * - Segment access redirect() produces HTTP 302
 * - Slot denial renders denied.tsx while page remains visible
 * - Slot denial falls back to default.tsx when no denied.tsx exists
 * - Nested access gates execute top-down (parent first)
 * - access.ts runs for API routes (route.ts)
 *
 * Design docs: design/04-authorization.md, design/13-security.md
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

test.describe('segment access control', () => {
  test('segment access deny produces 403', async ({ page }) => {
    const response = await page.goto('/auth-test/denied');
    expect(response?.status()).toBe(403);
    // The page.tsx should not render — access.ts denies before it
    await expect(page.locator('[data-testid="auth-denied-page"]')).not.toBeVisible();
  });

  test('deny(401) produces 401 status', async ({ page }) => {
    const response = await page.goto('/auth-test/deny-401');
    expect(response?.status()).toBe(401);
    // The page.tsx should not render
    await expect(page.locator('[data-testid="deny-401-page"]')).not.toBeVisible();
  });

  test('deny(404) produces 404 status', async ({ page }) => {
    const response = await page.goto('/auth-test/deny-404');
    expect(response?.status()).toBe(404);
    // The page.tsx should not render
    await expect(page.locator('[data-testid="deny-404-page"]')).not.toBeVisible();
  });

  test('segment access redirect produces 302', async ({ request }) => {
    // Use request context to follow redirects manually
    const response = await request.get('/auth-test/redirect', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toBe('/');
  });
});

test.describe('nested access gates', () => {
  test('nested access gates execute in order', async ({ page }) => {
    // Parent access.ts passes, child access.ts denies → HTTP 403
    const response = await page.goto('/auth-test/nested/child');
    expect(response?.status()).toBe(403);
    // The child page should not render
    await expect(page.locator('[data-testid="nested-child-page"]')).not.toBeVisible();
  });
});

test.describe('slot access control', () => {
  test('slot denial renders denied.tsx', async ({ page }) => {
    const response = await page.goto('/auth-test/parallel');
    expect(response?.status()).toBe(200);
    // Main page content is always visible
    await expect(page.locator('[data-testid="parallel-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="parallel-heading"]')).toHaveText(
      'Parallel Slot Auth Test'
    );
    // Admin slot shows denied.tsx, not the admin page
    await expect(page.locator('[data-testid="admin-denied"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-denied-message"]')).toHaveText(
      'Admin access denied'
    );
    // Admin page content should not be visible
    await expect(page.locator('[data-testid="admin-slot-page"]')).not.toBeVisible();
  });

  test('slot denial falls back to default.tsx', async ({ page }) => {
    // Slot with access.ts that denies, no denied.tsx, but has default.tsx
    const response = await page.goto('/auth-test/parallel-default');
    expect(response?.status()).toBe(200);
    // Main page content is visible
    await expect(page.locator('[data-testid="parallel-default-page"]')).toBeVisible();
    // Widget slot denied → falls back to default.tsx
    await expect(page.locator('[data-testid="widget-default"]')).toBeVisible();
    await expect(page.locator('[data-testid="widget-default-message"]')).toHaveText(
      'Widget default fallback'
    );
    // Widget page should not be visible
    await expect(page.locator('[data-testid="widget-page"]')).not.toBeVisible();
  });
});

test.describe('API route access control', () => {
  test('access.ts runs for API routes', async ({ request }) => {
    // API route with access.ts that denies(401) — handler should never execute.
    // The co-located 401.json is served as the deny response body.
    const response = await request.get('/auth-test/api-guarded');
    expect(response.status()).toBe(401);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
    const body = await response.json();
    // Must be the static 401.json, not the handler's JSON
    expect(body).not.toHaveProperty('message', 'should not reach here');
    expect(body).toHaveProperty('error', true);
  });
});
