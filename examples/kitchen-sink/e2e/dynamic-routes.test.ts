/**
 * E2E tests for dynamic route segments, catch-all, optional catch-all, and route groups.
 *
 * Validates:
 * - [id] dynamic segment renders with extracted param
 * - [...slug] catch-all matches multiple segments
 * - [[...slug]] optional catch-all matches zero and multi segments
 * - Route groups (group-a), (group-b) don't add URL depth
 *
 * Design docs: design/07-routing.md §Route Matching
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

test.describe('dynamic segments', () => {
  test('dynamic segment renders with extracted param', async ({ page }) => {
    const response = await page.goto('/routes-test/hello-world');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="dynamic-id-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="dynamic-id-value"]')).toHaveText('hello-world');
  });

  test('dynamic segment with numeric id', async ({ page }) => {
    const response = await page.goto('/routes-test/42');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="dynamic-id-value"]')).toHaveText('42');
  });
});

test.describe('catch-all segments', () => {
  test('catch-all matches multiple segments', async ({ page }) => {
    const response = await page.goto('/routes-test/catch/a/b/c');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="catch-all-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="catch-all-value"]')).toHaveText('a/b/c');
  });

  test('catch-all matches single segment', async ({ page }) => {
    const response = await page.goto('/routes-test/catch/only');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="catch-all-value"]')).toHaveText('only');
  });
});

test.describe('optional catch-all segments', () => {
  test('optional catch-all matches root path', async ({ page }) => {
    const response = await page.goto('/routes-test/optional');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="optional-catch-all-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="optional-catch-all-value"]')).toHaveText(
      '(no segments)'
    );
  });

  test('optional catch-all matches multiple segments', async ({ page }) => {
    const response = await page.goto('/routes-test/optional/x/y/z');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="optional-catch-all-value"]')).toHaveText('x/y/z');
  });
});

test.describe('route groups', () => {
  test('route group does not add URL segment', async ({ page }) => {
    // (group-a) is transparent — URL is /routes-test/grouped-a, not /routes-test/group-a/grouped-a
    const response = await page.goto('/routes-test/grouped-a');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="grouped-a-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="grouped-a-heading"]')).toHaveText('Route Group A');
  });

  test('separate route groups serve different pages', async ({ page }) => {
    const response = await page.goto('/routes-test/grouped-b');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="grouped-b-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="grouped-b-heading"]')).toHaveText('Route Group B');
  });
});
