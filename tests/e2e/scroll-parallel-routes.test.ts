/**
 * E2E Tests — Scroll Restoration with Parallel Routes
 *
 * Tests that forward navigation between pages with parallel routes
 * correctly scrolls to top, and that scroll={false} still works.
 *
 * Bug (LOCAL-329): When navigating between pages that share a layout with
 * parallel route slots, scroll position was incorrectly preserved instead
 * of scrolling to top.
 *
 * Fixture: tests/fixtures/phase2-app/app/parallel/
 *
 * Design docs: design/19-client-navigation.md §Scroll Restoration
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

/**
 * Inject a persistent <style> tag that makes all parallel route content areas
 * tall enough to scroll. This survives React re-renders because it's injected
 * into <head>, not onto the content elements themselves.
 */
async function injectTallContentStyle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      [data-testid="parallel-home-content"],
      [data-testid="parallel-projects-content"],
      [data-testid="parallel-about-content"] {
        min-height: 3000px !important;
      }
    `;
    document.head.appendChild(style);
  });
}

// ─── Forward Navigation Scrolls to Top (Overflow Container) ──────────────────
//
// Tests the core bug: layouts with overflow-y-auto containers inside h-screen.
// In this pattern, window.scrollY is always 0 — real scroll is on the overflow
// container. The router must detect and reset these containers.

test.describe('scroll to top with overflow container', () => {
  test('resets overflow container scroll on forward navigation', async ({ page }) => {
    await page.goto('/parallel');
    await waitForHydration(page);

    // Convert the layout to use an overflow container (like relisten-web does).
    // This simulates: <div class="h-screen"><div class="overflow-y-auto">...</div></div>
    await page.evaluate(() => {
      const layout = document.querySelector('[data-testid="parallel-layout"]') as HTMLElement;
      if (layout) {
        // Make layout a fixed-height scroll container
        layout.style.height = '100vh';
        layout.style.overflowY = 'auto';
      }
      // Make content tall to enable scrolling
      const content = document.querySelector('[data-testid="parallel-home-content"]') as HTMLElement;
      if (content) {
        content.style.minHeight = '3000px';
      }
    });

    // Scroll the overflow container down
    await page.evaluate(() => {
      const layout = document.querySelector('[data-testid="parallel-layout"]') as HTMLElement;
      layout.scrollTop = 500;
    });
    await page.waitForFunction(() => {
      const layout = document.querySelector('[data-testid="parallel-layout"]') as HTMLElement;
      return layout && layout.scrollTop >= 490;
    });

    // Navigate to projects
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="link-parallel-projects"]') as HTMLElement;
      el.click();
    });
    await page.waitForURL('/parallel/projects');
    await expect(page.locator('[data-testid="parallel-projects-content"]')).toBeVisible();

    // The overflow container's scrollTop should be reset to 0
    await page.waitForFunction(
      () => {
        const layout = document.querySelector('[data-testid="parallel-layout"]') as HTMLElement;
        return layout && layout.scrollTop === 0;
      },
      null,
      { timeout: 10_000 }
    );
  });
});

// ─── Forward Navigation Scrolls to Top ────────────────────────────────────────

test.describe('scroll to top on parallel route navigation', () => {
  test('scrolls to top when navigating from /parallel to /parallel/projects', async ({ page }) => {
    await page.goto('/parallel');
    await waitForHydration(page);
    await injectTallContentStyle(page);

    // Scroll down on the home page
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForFunction(() => window.scrollY >= 490);

    // Navigate to projects via Link (forward navigation, default scroll=true)
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="link-parallel-projects"]') as HTMLElement;
      el.click();
    });
    await page.waitForURL('/parallel/projects');
    await expect(page.locator('[data-testid="parallel-projects-content"]')).toBeVisible();

    // Scroll should be restored to top after navigation
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 10_000 });
  });

  test('scrolls to top when navigating from /parallel/projects to /parallel', async ({ page }) => {
    await page.goto('/parallel/projects');
    await waitForHydration(page);
    await injectTallContentStyle(page);

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForFunction(() => window.scrollY >= 390);

    // Navigate back to home
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="link-parallel-home"]') as HTMLElement;
      el.click();
    });
    await page.waitForURL('/parallel');
    await expect(page.locator('[data-testid="parallel-home-content"]')).toBeVisible();

    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 10_000 });
  });

  test('scrolls to top when navigating to unmatched slot route', async ({ page }) => {
    await page.goto('/parallel');
    await waitForHydration(page);
    await injectTallContentStyle(page);

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForFunction(() => window.scrollY >= 290);

    // Navigate to about (sidebar shows default.tsx)
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="link-parallel-about"]') as HTMLElement;
      el.click();
    });
    await page.waitForURL('/parallel/about');
    await expect(page.locator('[data-testid="parallel-about-content"]')).toBeVisible();

    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 10_000 });
  });
});

// ─── Back/Forward Restores Scroll ────────────────────────────────────────────

test.describe('back/forward scroll restoration with parallel routes', () => {
  test('back button restores scroll position in parallel route page', async ({ page }) => {
    await page.goto('/parallel');
    await waitForHydration(page);
    await injectTallContentStyle(page);

    // Scroll down on home page
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForFunction(() => window.scrollY >= 490);

    // Navigate to projects (scroll to top)
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="link-parallel-projects"]') as HTMLElement;
      el.click();
    });
    await page.waitForURL('/parallel/projects');
    await expect(page.locator('[data-testid="parallel-projects-content"]')).toBeVisible();
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 10_000 });

    // Go back — should restore scroll position of 500
    await page.goBack();
    await page.waitForURL('/parallel');
    await expect(page.locator('[data-testid="parallel-home-content"]')).toBeVisible();
    await page.waitForFunction(() => Math.abs(window.scrollY - 500) < 20, null, {
      timeout: 10_000,
    });
  });
});

// ─── scroll={false} Still Works ──────────────────────────────────────────────

test.describe('scroll={false} with parallel routes', () => {
  test('scroll={false} preserves scroll position during parallel route navigation', async ({
    page,
  }) => {
    await page.goto('/parallel');
    await waitForHydration(page);
    await injectTallContentStyle(page);

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForFunction(() => window.scrollY >= 390);

    // Navigate to projects via the scroll={false} link
    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="link-parallel-projects-noscroll"]'
      ) as HTMLElement;
      el.click();
    });
    await page.waitForURL('/parallel/projects');
    await expect(page.locator('[data-testid="parallel-projects-content"]')).toBeVisible();

    // Scroll should be preserved at ~400
    await page.waitForFunction(() => Math.abs(window.scrollY - 400) < 20, null, {
      timeout: 10_000,
    });
  });
});
