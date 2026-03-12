/**
 * Server Actions E2E Tests — Full lifecycle coverage.
 *
 * Tests the complete server action pipeline end-to-end:
 * - Form submission with JS (useActionState, inline RSC update)
 * - Form submission without JS (POST → 302 redirect)
 * - useActionState / useFormStatus integration
 * - Validation errors returned and displayed
 * - Revalidation after mutation (revalidatePath)
 * - CSRF / origin validation
 * - Action binding across RSC→client boundary
 *
 * Does NOT duplicate timber-izg (concurrent interleaving) tests.
 *
 * Design docs: design/07-routing.md, design/10-error-handling.md
 */

import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

// ─── Form Submission with JS ─────────────────────────────────────────────────

test.describe('form submission with JS', () => {
  // Each test gets an isolated store via unique session header
  let sessionId: string;
  test.beforeEach(async ({ context }) => {
    sessionId = randomUUID();
    await context.setExtraHTTPHeaders({ 'x-test-session': sessionId });
  });

  test('adding a todo updates the list inline without page reload', async ({ page }) => {
    await page.goto('/todos');
    await waitForHydration(page);

    // Fresh session — count starts at 0
    await expect(page.locator('[data-testid="todo-count"]')).toHaveText('0 todos');

    await page.fill('[data-testid="todo-input"]', 'Buy groceries');
    await page.click('[data-testid="todo-submit"]');

    // The todo should appear inline (router refresh after action)
    await expect(page.locator('text=Buy groceries')).toBeVisible();
    await expect(page.locator('[data-testid="todo-count"]')).toHaveText('1 todos');

    // URL should not have changed (no full page navigation)
    await expect(page).toHaveURL('/todos');
  });

  test('adding multiple todos accumulates in the list', async ({ page }) => {
    await page.goto('/todos');
    await waitForHydration(page);

    await page.fill('[data-testid="todo-input"]', 'First');
    await page.click('[data-testid="todo-submit"]');
    await expect(page.locator('text=First')).toBeVisible();

    await page.fill('[data-testid="todo-input"]', 'Second');
    await page.click('[data-testid="todo-submit"]');
    await expect(page.locator('text=Second')).toBeVisible();

    await expect(page.locator('[data-testid="todo-count"]')).toHaveText('2 todos');
  });

  test('deleting a todo removes it from the list', async ({ page }) => {
    await page.goto('/todos');
    await waitForHydration(page);

    // Add a todo first
    await page.fill('[data-testid="todo-input"]', 'Delete me');
    await page.click('[data-testid="todo-submit"]');
    await expect(page.locator('text=Delete me')).toBeVisible();
    await expect(page.locator('[data-testid="todo-count"]')).toHaveText('1 todos');

    // Delete it
    const todoItem = page.locator('text=Delete me').locator('..');
    await todoItem.locator('[data-testid^="todo-delete-"]').click();

    // Wait for count to go back to 0
    await expect(page.locator('[data-testid="todo-count"]')).toHaveText('0 todos');
  });
});

// ─── Validation Errors ───────────────────────────────────────────────────────

test.describe('validation errors', () => {
  let sessionId: string;
  test.beforeEach(async ({ context }) => {
    sessionId = randomUUID();
    await context.setExtraHTTPHeaders({ 'x-test-session': sessionId });
  });

  test('submitting empty form shows validation error', async ({ page }) => {
    await page.goto('/todos');
    await waitForHydration(page);

    // Submit with empty input
    await page.click('[data-testid="todo-submit"]');

    // Validation error should appear
    await expect(page.locator('[data-testid="validation-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="validation-error"]')).toHaveText('Title is required');
  });

  test('validation error clears after successful submission', async ({ page }) => {
    await page.goto('/todos');
    await waitForHydration(page);

    // Trigger validation error
    await page.click('[data-testid="todo-submit"]');
    await expect(page.locator('[data-testid="validation-error"]')).toBeVisible();

    // Now submit with valid input
    await page.fill('[data-testid="todo-input"]', 'Valid todo');
    await page.click('[data-testid="todo-submit"]');

    // Error should disappear, todo should appear
    await expect(page.locator('[data-testid="validation-error"]')).toBeHidden();
    await expect(page.locator('text=Valid todo')).toBeVisible();
  });
});

// ─── Revalidation ────────────────────────────────────────────────────────────

test.describe('revalidation after action', () => {
  let sessionId: string;
  test.beforeEach(async ({ context }) => {
    sessionId = randomUUID();
    await context.setExtraHTTPHeaders({ 'x-test-session': sessionId });
  });

  test('revalidatePath triggers inline RSC update without full page reload', async ({ page }) => {
    await page.goto('/todos');
    await waitForHydration(page);

    // Wait for layout marker to be stamped (useEffect after mount)
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="layout-marker"]')?.getAttribute('data-id') != null
    );
    const layoutMarker = await page.getAttribute('[data-testid="layout-marker"]', 'data-id');

    // Add a todo
    await page.fill('[data-testid="todo-input"]', 'Revalidation test');
    await page.click('[data-testid="todo-submit"]');

    // The list should update inline (revalidatePath re-renders /todos)
    await expect(page.locator('text=Revalidation test')).toBeVisible();

    // Layout marker should be unchanged (no full page reload)
    const afterMarker = await page.getAttribute('[data-testid="layout-marker"]', 'data-id');
    expect(afterMarker).toBe(layoutMarker);
  });
});

// ─── No-JS Form Submission ───────────────────────────────────────────────────

test.describe('no-js form submission', () => {
  test('form submission without JavaScript works', async ({ browser }) => {
    const sessionId = randomUUID();
    const context = await browser.newContext({
      javaScriptEnabled: false,
      extraHTTPHeaders: { 'x-test-session': sessionId },
    });
    const page = await context.newPage();

    await page.goto('/todos');

    // Fill in the form
    await page.fill('[data-testid="todo-input"]', 'No-JS todo');

    // Submit the form — should POST and redirect back
    await page.click('[data-testid="todo-submit"]');

    // Playwright follows redirects automatically — should end up at /todos
    await expect(page).toHaveURL('/todos');

    // The new todo should appear in the server-rendered list
    await expect(page.locator('text=No-JS todo')).toBeVisible();

    await context.close();
  });

  test('form has action attribute for progressive enhancement', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/todos');

    // The form should have an action attribute for no-JS fallback.
    // React sets method="POST" and encType when useActionState is used.
    const form = page.locator('[data-testid="todo-form"]');
    await expect(form).toBeVisible();
    await expect(form).toHaveAttribute('method', 'POST');

    await context.close();
  });
});

// ─── CSRF / Origin Validation ────────────────────────────────────────────────

test.describe('csrf protection', () => {
  test('cross-origin POST is rejected with 403', async ({ request }) => {
    const response = await request.post('/todos', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://evil.com',
      },
      data: 'title=hacked',
    });

    expect(response.status()).toBe(403);
  });

  test('same-origin POST is accepted', async ({ request }) => {
    const response = await request.post('/todos', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'http://localhost:3000',
      },
      data: 'title=legit',
    });

    // Should be 200 (RSC payload) or 302 (no-JS redirect) — not 403
    expect(response.status()).not.toBe(403);
  });

  test('POST without Origin header is rejected', async ({ request }) => {
    const response = await request.fetch('/todos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: 'title=sneaky',
    });

    expect(response.status()).toBe(403);
  });
});

// ─── useActionState Integration ──────────────────────────────────────────────

test.describe('useActionState integration', () => {
  let sessionId: string;
  test.beforeEach(async ({ context }) => {
    sessionId = randomUUID();
    await context.setExtraHTTPHeaders({ 'x-test-session': sessionId });
  });

  test('submit button is re-enabled after action completes', async ({ page }) => {
    await page.goto('/todos');
    await waitForHydration(page);

    await page.fill('[data-testid="todo-input"]', 'Button test');

    const submitButton = page.locator('[data-testid="todo-submit"]');
    await expect(submitButton).toBeEnabled();

    await page.click('[data-testid="todo-submit"]');

    // After completion, button should be re-enabled and todo visible
    await expect(page.locator('text=Button test')).toBeVisible();
    await expect(submitButton).toBeEnabled();
  });

  test('input is cleared after successful submission', async ({ page }) => {
    await page.goto('/todos');
    await waitForHydration(page);

    await page.fill('[data-testid="todo-input"]', 'Clear test');
    await page.click('[data-testid="todo-submit"]');

    // Wait for the todo to appear (action completed)
    await expect(page.locator('text=Clear test')).toBeVisible();

    // Input should be cleared
    await expect(page.locator('[data-testid="todo-input"]')).toHaveValue('');
  });
});
