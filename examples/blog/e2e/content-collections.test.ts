/**
 * E2E tests for the blog example app demonstrating content collections.
 *
 * Tests: blog index renders, individual posts render, draft filtering,
 * 404 for missing slugs, changelog data collection, metadata correctness.
 *
 * These tests use a colocated Playwright config at
 * examples/blog/playwright.config.ts targeting the examples/blog/ app.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Blog index
// ---------------------------------------------------------------------------

test('blog index renders published posts', async ({ page }) => {
  const response = await page.goto('/blog');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-testid="blog-index"]')).toBeVisible();
  await expect(page.locator('[data-testid="blog-list"]')).toBeVisible();

  // Should have exactly 2 published posts (draft-post is excluded)
  const items = page.locator('[data-testid="blog-item"]');
  await expect(items).toHaveCount(2);
});

test('blog index excludes draft posts', async ({ page }) => {
  await page.goto('/blog');

  // "Draft Post" should not appear
  const content = await page.locator('[data-testid="blog-list"]').textContent();
  expect(content).not.toContain('Draft Post');
});

test('blog index shows posts sorted by date (newest first)', async ({ page }) => {
  await page.goto('/blog');

  const titles = await page.locator('[data-testid="blog-item"] h2').allTextContents();
  // "Advanced Patterns" (Feb 20) should come before "Hello World" (Jan 15)
  expect(titles[0]).toBe('Advanced Patterns');
  expect(titles[1]).toBe('Hello World');
});

test('blog index shows tags', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.locator('[data-testid="blog-tags"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="blog-tag"]').first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Individual blog post
// ---------------------------------------------------------------------------

test('individual blog post renders', async ({ page }) => {
  const response = await page.goto('/blog/hello-world');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-testid="blog-post"]')).toBeVisible();
  await expect(page.locator('[data-testid="blog-post-header"] h1')).toHaveText('Hello World');
});

test('blog post shows author', async ({ page }) => {
  await page.goto('/blog/hello-world');
  await expect(page.locator('[data-testid="blog-post-author"]')).toContainText('Jane Developer');
});

test('blog post shows tags', async ({ page }) => {
  await page.goto('/blog/hello-world');
  await expect(page.locator('[data-testid="blog-post-tags"]')).toBeVisible();
});

// TODO: returns 500 instead of 404 — needs notFound() support in dynamic routes
test.fixme('blog post returns 404 for missing slug', async ({ page }) => {
  const response = await page.goto('/blog/nonexistent-post');
  expect(response?.status()).toBe(404);
});

test('blog post metadata is correct', async ({ page }) => {
  await page.goto('/blog/hello-world');
  const title = await page.title();
  expect(title).toContain('Hello World');
});

// ---------------------------------------------------------------------------
// Changelog (data collection)
// ---------------------------------------------------------------------------

test('changelog page renders', async ({ page }) => {
  const response = await page.goto('/changelog');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-testid="changelog"]')).toBeVisible();
});

test('changelog shows releases sorted by date', async ({ page }) => {
  await page.goto('/changelog');

  const releases = page.locator('[data-testid="changelog-release"]');
  await expect(releases).toHaveCount(2);

  // v1.1.0 (Feb 15) should come before v1.0.0 (Jan 1)
  const headers = await releases.locator('h2').allTextContents();
  expect(headers[0]).toBe('v1.1.0');
  expect(headers[1]).toBe('v1.0.0');
});

test('changelog shows change entries', async ({ page }) => {
  await page.goto('/changelog');

  const changes = page.locator('[data-testid="changelog-change"]');
  // v1.0.0 has 3 changes, v1.1.0 has 3 changes = 6 total
  await expect(changes).toHaveCount(6);
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test('site header is present with nav links', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="site-header"]')).toBeVisible();
  await expect(page.locator('[data-testid="home-content"]')).toBeVisible();
});
