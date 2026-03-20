/**
 * E2E Tests — useLinkStatus pending state
 *
 * Verifies that useLinkStatus() returns { pending: true } for the specific
 * link being navigated to, and { pending: false } for other links.
 *
 * This tests the full flow:
 *   Click → router.navigate() → TransitionRoot useOptimistic (urgent) →
 *   PendingNavigationContext → LinkStatusProvider → useLinkStatus
 *
 * The slow-page fixture has a 2s server delay, giving us a reliable window
 * to observe the pending state.
 *
 * Design doc: design/19-client-navigation.md §"useLinkStatus()"
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

test.describe('useLinkStatus', () => {
  test('shows pending for clicked link, idle for other links', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    // Both links should start as not pending
    const slowStatus = page.locator('[data-testid="link-status-slow-status"]');
    const dashStatus = page.locator('[data-testid="link-status-dashboard-status"]');

    await expect(slowStatus).toHaveAttribute('data-pending', 'false');
    await expect(dashStatus).toHaveAttribute('data-pending', 'false');

    // Click the slow page link — triggers a 2s server render
    await page.click('[data-testid="link-status-slow"]');

    // The slow link should show pending, dashboard link should stay idle
    await expect(slowStatus).toHaveAttribute('data-pending', 'true', { timeout: 5_000 });
    await expect(dashStatus).toHaveAttribute('data-pending', 'false');

    // After navigation completes, pending should clear
    await page.waitForURL('/slow-page', { timeout: 10_000 });
    await expect(page.locator('[data-testid="slow-page-content"]')).toBeVisible();

    // Go back to verify we can check status again
    await page.goBack();
    await page.waitForURL('/');
    await expect(slowStatus).toHaveAttribute('data-pending', 'false', { timeout: 5_000 });
  });

  test('useNavigationPending shows true during navigation', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    const pendingIndicator = page.locator('[data-testid="nav-pending"]');

    // Should start hidden
    await expect(pendingIndicator).toBeHidden();

    // Click slow page link
    await page.click('[data-testid="link-status-slow"]');

    // Global pending should show
    await expect(pendingIndicator).toBeVisible({ timeout: 5_000 });

    // After navigation completes, should hide
    await page.waitForURL('/slow-page', { timeout: 10_000 });
    await expect(pendingIndicator).toBeHidden({ timeout: 5_000 });
  });

  test('pending state and params update atomically (no gap)', async ({ page }) => {
    // This is the core LOCAL-318 regression test.
    // Navigate to a page, then navigate to slow-page.
    // During navigation: link should show pending.
    // After navigation: pending clears and new content shows in the same frame.
    // There must be NO frame where pending is false but old content is still visible.
    await page.goto('/dashboard');
    await waitForHydration(page);

    // Navigate back to home to set up the test
    await page.goto('/');
    await waitForHydration(page);

    const slowStatus = page.locator('[data-testid="link-status-slow-status"]');

    // Collect state transitions by polling
    const transitions: { pending: string; url: string }[] = [];
    const pollInterval = setInterval(async () => {
      try {
        const pending = await slowStatus.getAttribute('data-pending');
        const url = page.url();
        const last = transitions[transitions.length - 1];
        // Only record when state changes
        if (!last || last.pending !== pending || last.url !== url) {
          transitions.push({ pending: pending ?? 'null', url });
        }
      } catch {
        // Element may not exist during navigation
      }
    }, 50);

    // Click and wait for navigation to complete
    await page.click('[data-testid="link-status-slow"]');
    await page.waitForURL('/slow-page', { timeout: 10_000 });

    // Wait a beat for final state
    await page.waitForTimeout(200);
    clearInterval(pollInterval);

    // Verify no transition where pending=false but URL is still /
    // (that would be the two-commit gap we fixed)
    const badTransition = transitions.find(
      (t) => t.pending === 'false' && t.url.endsWith('/') && transitions.indexOf(t) > 0
    );
    expect(badTransition).toBeUndefined();
  });
});
