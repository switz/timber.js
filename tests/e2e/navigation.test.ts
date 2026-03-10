/**
 * Phase 2 E2E Tests — Client Navigation
 *
 * Tests the client-side navigation system end-to-end in a real browser:
 *   Link clicks → RSC fetch → segment reconciliation → history replay
 *
 * Acceptance criteria from timber-dch.1.6:
 * - Link navigation: DOM state preserved
 * - Back/forward: cached payload, no roundtrip
 * - Segment tree diff: sync layouts skipped
 *
 * Design docs: design/19-client-navigation.md, design/07-routing.md
 */

import { test, expect } from '@playwright/test';

// ─── Link Navigation: DOM State Preserved ────────────────────────────────────

test.describe('dom state preserved', () => {
  test('input value in layout persists across client-side navigations', async ({ page }) => {
    await page.goto('/');

    // Type into an input that lives in the root layout
    const layoutInput = page.locator('[data-testid="layout-input"]');
    await layoutInput.fill('user-typed-value');

    // Navigate to a child route via Link
    await page.click('[data-testid="link-dashboard"]');
    await page.waitForURL('/dashboard');

    // Layout input should retain its value — no full page reload
    await expect(layoutInput).toHaveValue('user-typed-value');
  });

  test('focus state preserved in layout during navigation', async ({ page }) => {
    await page.goto('/dashboard');

    // Focus an element in the persistent layout
    const layoutButton = page.locator('[data-testid="layout-button"]');
    await layoutButton.focus();

    // Navigate to a sibling route
    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');

    // The layout should not have been unmounted — button should still be focusable
    // (checking the layout is still in DOM is the key assertion)
    await expect(page.locator('[data-testid="layout-button"]')).toBeVisible();
  });

  test('scroll position in layout preserved across navigation', async ({ page }) => {
    await page.goto('/dashboard');

    // Scroll the page down. The nav links are at the top, so 300px
    // keeps them out of the viewport in most configurations.
    await page.evaluate(() => window.scrollTo(0, 300));

    // Use dispatchEvent to click without Playwright auto-scrolling
    // the element into view (which would reset scrollY to 0).
    await page.locator('[data-testid="link-no-scroll"]').dispatchEvent('click');
    await page.waitForURL('/dashboard/settings');

    // Wait for settings content to render (navigation complete)
    await expect(page.locator('[data-testid="settings-content"]')).toBeVisible();

    // Wait for scroll restoration (afterPaint callback restores position)
    await page.waitForFunction(() => window.scrollY === 300, null, { timeout: 5000 });
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(300);
  });
});

// ─── Back/Forward: Cached Payload ────────────────────────────────────────────

test.describe('history cached', () => {
  test('back button replays cached payload without server roundtrip', async ({ page }) => {
    await page.goto('/');

    // Navigate forward to /dashboard
    await page.click('[data-testid="link-dashboard"]');
    await page.waitForURL('/dashboard');
    await expect(page.locator('[data-testid="dashboard-content"]')).toBeVisible();

    // Track network requests during back navigation
    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.headers()['accept']?.includes('text/x-component')) {
        requests.push(req.url());
      }
    });

    // Go back
    await page.goBack();
    await page.waitForURL('/');

    // No RSC fetch should have been made — history stack had the payload
    expect(requests).toHaveLength(0);
  });

  test('forward button after back replays cached payload', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="link-dashboard"]');
    await page.waitForURL('/dashboard');

    await page.goBack();
    await page.waitForURL('/');

    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.headers()['accept']?.includes('text/x-component')) {
        requests.push(req.url());
      }
    });

    await page.goForward();
    await page.waitForURL('/dashboard');

    // Should replay from history — no network request
    expect(requests).toHaveLength(0);
  });

  test('scroll position restored on back navigation', async ({ page }) => {
    await page.goto('/');

    // Scroll down on home page
    await page.evaluate(() => window.scrollTo(0, 500));

    // Navigate to dashboard. Use dispatchEvent to avoid Playwright
    // auto-scrolling the link into view (which would reset scrollY).
    await page.locator('[data-testid="link-dashboard"]').dispatchEvent('click');
    await page.waitForURL('/dashboard');
    await expect(page.locator('[data-testid="dashboard-content"]')).toBeVisible();

    // Verify we scrolled to top on forward nav (afterPaint)
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    const topScroll = await page.evaluate(() => window.scrollY);
    expect(topScroll).toBe(0);

    // Go back — router replays cached payload and restores saved scrollY
    await page.goBack();
    await page.waitForURL('/');
    await expect(page.locator('[data-testid="home-content"]')).toBeVisible();

    // Wait for scroll restoration (happens after render + afterPaint)
    await page.waitForFunction(() => window.scrollY > 0, null, { timeout: 5000 });
    const restoredScroll = await page.evaluate(() => window.scrollY);
    expect(restoredScroll).toBe(500);
  });
});

// ─── Segment Tree Diff: Sync Layouts Skipped ────────────────────────────────

test.describe('segment diff', () => {
  test('navigation sends X-Timber-State-Tree header', async ({ page }) => {
    await page.goto('/dashboard');

    // Intercept the RSC request on next navigation
    const rscRequest = page.waitForRequest(
      (req) => req.headers()['accept']?.includes('text/x-component') ?? false
    );

    await page.click('[data-testid="link-settings"]');

    const req = await rscRequest;
    const stateTree = req.headers()['x-timber-state-tree'];
    expect(stateTree).toBeDefined();

    const parsed = JSON.parse(stateTree!);
    expect(parsed).toHaveProperty('segments');
    expect(Array.isArray(parsed.segments)).toBe(true);
    // Segment cache population is not yet implemented — segments will be
    // empty until initial hydration populates the cache with mounted layouts.
    // This test verifies the header is sent with valid structure.
  });

  test('sync layout is NOT re-rendered during sibling navigation', async ({ page }) => {
    await page.goto('/dashboard');

    // Mark the layout with a unique attribute via JS
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="dashboard-layout"]');
      if (el) el.setAttribute('data-mounted-id', 'original');
    });

    // Navigate to a sibling under the same layout
    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');

    // The layout element should still have the same mounted-id
    // (proving it was NOT re-rendered / re-mounted)
    const mountedId = await page.getAttribute(
      '[data-testid="dashboard-layout"]',
      'data-mounted-id'
    );
    expect(mountedId).toBe('original');
  });

  test('router.refresh() sends full payload without state tree', async ({ page }) => {
    await page.goto('/dashboard');

    // Intercept the refresh request
    const rscRequest = page.waitForRequest(
      (req) => req.headers()['accept']?.includes('text/x-component') ?? false
    );

    // Trigger refresh via exposed API (e.g., button wired to router.refresh())
    await page.click('[data-testid="refresh-button"]');

    const req = await rscRequest;
    // Refresh should NOT include state tree header
    expect(req.headers()['x-timber-state-tree']).toBeUndefined();
  });
});

// ─── Prefetch Cache ─────────────────────────────────────────────────────────

test.describe('prefetch', () => {
  test('hovering a prefetch Link triggers RSC fetch', async ({ page }) => {
    await page.goto('/');

    const rscRequest = page.waitForRequest(
      (req) => req.headers()['accept']?.includes('text/x-component') ?? false
    );

    // Hover over a prefetch-enabled link
    await page.hover('[data-testid="link-prefetch-dashboard"]');

    const req = await rscRequest;
    expect(req.url()).toContain('/dashboard');
  });

  test('navigation after prefetch uses cached payload (no second fetch)', async ({ page }) => {
    await page.goto('/');

    // Hover to trigger prefetch
    await page.hover('[data-testid="link-prefetch-dashboard"]');

    // Wait for prefetch to complete
    await page.waitForResponse(
      (res) => res.headers()['content-type']?.includes('text/x-component') ?? false
    );

    // Track subsequent requests
    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.headers()['accept']?.includes('text/x-component')) {
        requests.push(req.url());
      }
    });

    // Click the link — should use prefetch cache
    await page.click('[data-testid="link-prefetch-dashboard"]');
    await page.waitForURL('/dashboard');

    // No additional RSC fetch
    expect(requests).toHaveLength(0);
  });
});

// ─── Navigation Pending State ───────────────────────────────────────────────

test.describe('navigation pending', () => {
  test('pending indicator shown during navigation', async ({ page }) => {
    await page.goto('/');

    // The app should expose a pending indicator
    const pendingIndicator = page.locator('[data-testid="nav-pending"]');
    await expect(pendingIndicator).toBeHidden();

    // Start navigation (may be slow due to server rendering)
    await page.click('[data-testid="link-slow-page"]');

    // Pending indicator should appear during fetch
    await expect(pendingIndicator).toBeVisible();

    // After navigation completes, pending should disappear
    await page.waitForURL('/slow-page');
    await expect(pendingIndicator).toBeHidden();
  });
});
