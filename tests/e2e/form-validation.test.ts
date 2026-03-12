/**
 * E2E Tests — Form Validation Architecture
 *
 * Tests the full form validation flow with progressive enhancement:
 * - With JS: inline validation errors, form value preservation via submittedValues
 * - No JS: validation errors displayed after re-render (no redirect), values repopulated
 * - Successful submissions redirect (PRG preserved for happy path)
 * - Both Zod-style and Standard Schema work
 *
 * Design doc: design/08-forms-and-actions.md
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

// ─── With-JS Tests ──────────────────────────────────────────────────────

test.describe('form validation (with JS)', () => {
  test('shows validation errors inline on empty submit', async ({ page }) => {
    await page.goto('/validated-form');
    await waitForHydration(page);

    await page.click('[data-testid="submit-button"]');

    // Should show field errors
    await expect(page.locator('[data-testid="name-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="email-error"]')).toBeVisible();
  });

  test('shows success message on valid submit', async ({ page }) => {
    await page.goto('/validated-form');
    await waitForHydration(page);

    await page.fill('[data-testid="name-input"]', 'Alice');
    await page.fill('[data-testid="email-input"]', 'alice@example.com');
    await page.click('[data-testid="submit-button"]');

    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="success-message"]')).toContainText('Alice');
  });

  test('preserves submitted values on validation failure', async ({ page }) => {
    await page.goto('/validated-form');
    await waitForHydration(page);

    // Fill in name but leave email empty
    await page.fill('[data-testid="name-input"]', 'Bob');
    await page.click('[data-testid="submit-button"]');

    // Should show email error
    await expect(page.locator('[data-testid="email-error"]')).toBeVisible();

    // Name field should still have the submitted value
    // (via submittedValues in the ActionResult)
    await expect(page.locator('[data-testid="name-input"]')).toHaveValue('Bob');
  });
});

// ─── No-JS Tests ────────────────────────────────────────────────────────

test.describe('form validation (no JS)', () => {
  test('shows validation errors after submission without redirect', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/validated-form');
    await page.click('[data-testid="submit-button"]');

    // Should re-render the page (not redirect) with validation errors
    await expect(page.locator('[data-testid="name-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="email-error"]')).toBeVisible();

    // Should still be on the same URL (no PRG redirect for validation failures)
    await expect(page).toHaveURL('/validated-form');

    await context.close();
  });

  test('repopulates submitted values on validation failure', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/validated-form');
    await page.fill('[data-testid="name-input"]', 'Charlie');
    // Leave email empty to trigger validation
    await page.click('[data-testid="submit-button"]');

    // Should show error for email
    await expect(page.locator('[data-testid="email-error"]')).toBeVisible();

    // Name should be repopulated from submittedValues
    await expect(page.locator('[data-testid="name-input"]')).toHaveValue('Charlie');

    await context.close();
  });

  test('successful no-JS submission redirects (PRG preserved)', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/validated-form');
    await page.fill('[data-testid="name-input"]', 'Diana');
    await page.fill('[data-testid="email-input"]', 'diana@example.com');
    await page.click('[data-testid="submit-button"]');

    // Successful submission should redirect back (PRG pattern)
    await expect(page).toHaveURL('/validated-form');
    // No validation errors should be shown
    await expect(page.locator('[data-testid="name-error"]')).not.toBeVisible();

    await context.close();
  });
});
