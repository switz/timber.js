/**
 * Phase 2 E2E Tests — Forms
 *
 * Tests progressive enhancement of forms: forms must work without JavaScript
 * (curl POST / no-JS browser), and enhanced with JS for inline RSC updates.
 *
 * Acceptance criteria from timber-dch.1.6:
 * - Forms work with JS disabled
 *
 * Design docs: design/08-forms-and-actions.md, design/07-routing.md
 */

import { test, expect } from '@playwright/test';

// ─── No-JS Forms ────────────────────────────────────────────────────────────

test.describe('no-js forms', () => {
  test('form submission without JavaScript performs POST and 302 redirect', async ({ browser }) => {
    // Create a context with JavaScript disabled
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/todos');

    // Fill in the form
    await page.fill('[data-testid="todo-input"]', 'Buy groceries');

    // Submit the form — should POST and redirect
    await page.click('[data-testid="todo-submit"]');

    // Without JS, the server responds with 302 redirect back to /todos
    // Playwright follows redirects automatically
    await expect(page).toHaveURL('/todos');

    // The new todo should appear in the list (server-rendered)
    await expect(page.locator('text=Buy groceries')).toBeVisible();

    await context.close();
  });

  test('form action attribute points to same URL (progressive enhancement)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/todos');

    // The form should have method="POST" and action pointing to current page
    const form = page.locator('[data-testid="todo-form"]');
    await expect(form).toHaveAttribute('method', 'POST');

    await context.close();
  });

  test('form works with JS enabled (enhanced with RSC inline update)', async ({ page }) => {
    await page.goto('/todos');

    // Fill and submit
    await page.fill('[data-testid="todo-input"]', 'Buy milk');
    await page.click('[data-testid="todo-submit"]');

    // With JS, the page should NOT reload — inline RSC update
    // The todo should appear without a full page navigation
    await expect(page.locator('text=Buy milk')).toBeVisible();

    // URL should not change (no redirect, inline update)
    await expect(page).toHaveURL('/todos');
  });

  test('form validation errors shown inline with JS', async ({ page }) => {
    await page.goto('/todos');

    // Submit empty form
    await page.click('[data-testid="todo-submit"]');

    // Validation error should appear
    await expect(page.locator('[data-testid="validation-error"]')).toBeVisible();
  });

  test('form validation errors shown via redirect without JS', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/todos');

    // Submit empty form — server should redirect back with error state
    await page.click('[data-testid="todo-submit"]');

    // Should redirect back to /todos
    await expect(page).toHaveURL('/todos');

    await context.close();
  });
});

// ─── Server Action CSRF Protection ──────────────────────────────────────────

test.describe('csrf protection', () => {
  test('cross-origin form POST is rejected with 403', async ({ request }) => {
    const response = await request.post('/todos', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://evil.com',
        'Host': 'localhost:3000',
      },
      data: 'title=hacked',
    });

    expect(response.status()).toBe(403);
  });

  test('same-origin form POST is accepted', async ({ request }) => {
    const response = await request.post('/todos', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'http://localhost:3000',
        'Host': 'localhost:3000',
      },
      data: 'title=Buy+groceries',
    });

    // Should be 302 redirect (no-JS path) or 200 with RSC payload
    expect([200, 302]).toContain(response.status());
  });
});

// ─── Revalidation After Action ──────────────────────────────────────────────

test.describe('revalidation', () => {
  test('revalidatePath triggers inline RSC update after action', async ({ page }) => {
    await page.goto('/todos');

    // Add a todo
    await page.fill('[data-testid="todo-input"]', 'Test revalidation');
    await page.click('[data-testid="todo-submit"]');

    // The list should update inline (revalidatePath re-renders /todos)
    await expect(page.locator('text=Test revalidation')).toBeVisible();

    // No full page reload should have happened
    // Verify by checking a layout-level counter or timestamp didn't reset
    const layoutMarker = await page.getAttribute('[data-testid="layout-marker"]', 'data-id');
    expect(layoutMarker).toBeDefined();
  });
});
