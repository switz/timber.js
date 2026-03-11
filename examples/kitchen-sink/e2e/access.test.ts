/**
 * E2E tests for access.ts authorization behavior.
 *
 * Validates:
 * - Segment access deny() produces HTTP 403
 * - Segment access redirect() produces HTTP 302
 * - Slot denial renders denied.tsx while page remains visible
 *
 * Design docs: design/04-authorization.md
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

  test('segment access redirect produces 302', async ({ request }) => {
    // Use request context to follow redirects manually
    const response = await request.get('/auth-test/redirect', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toBe('/');
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
});
