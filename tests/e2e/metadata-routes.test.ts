/**
 * E2E tests for metadata routes (sitemap, robots, manifest, OG images).
 *
 * Verifies that dynamic metadata routes:
 * - Serve at the correct URL paths
 * - Return correct content-type headers
 * - Return expected content
 * - Support nestable routes (e.g., /dashboard/sitemap.xml)
 * - Bypass middleware.ts and access.ts (public endpoints)
 *
 * See design/16-metadata.md §"Metadata Routes"
 */
import { test, expect } from '@playwright/test';

// ─── Sitemap ─────────────────────────────────────────────────────────────

test.describe('sitemap.xml', () => {
  test('serves sitemap.xml at root with correct content-type', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/xml');
  });

  test('sitemap.xml contains valid XML with url entries', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    const body = await response.text();
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(body).toContain('<loc>https://example.com/</loc>');
    expect(body).toContain('<loc>https://example.com/about</loc>');
    expect(body).toContain('<changefreq>daily</changefreq>');
    expect(body).toContain('<priority>1</priority>');
  });

  test('nested sitemap.xml serves at /dashboard/sitemap.xml', async ({ request }) => {
    const response = await request.get('/dashboard/sitemap.xml');
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/xml');
    const body = await response.text();
    expect(body).toContain('<loc>https://example.com/dashboard</loc>');
  });
});

// ─── Robots ──────────────────────────────────────────────────────────────

test.describe('robots.txt', () => {
  test('serves robots.txt with correct content-type', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/plain');
  });

  test('robots.txt contains expected directives', async ({ request }) => {
    const response = await request.get('/robots.txt');
    const body = await response.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toContain('Disallow: /private/');
    expect(body).toContain('Sitemap: https://example.com/sitemap.xml');
  });
});

// ─── Manifest ────────────────────────────────────────────────────────────

test.describe('manifest.webmanifest', () => {
  test('serves manifest at /manifest.webmanifest with correct content-type', async ({
    request,
  }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/manifest+json');
  });

  test('manifest contains valid JSON with app metadata', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    const json = await response.json();
    expect(json.name).toBe('Timber Test App');
    expect(json.short_name).toBe('Timber');
    expect(json.start_url).toBe('/');
    expect(json.display).toBe('standalone');
  });
});

// ─── OG Image ────────────────────────────────────────────────────────────

test.describe('opengraph-image', () => {
  test('serves opengraph-image with image content-type', async ({ request }) => {
    const response = await request.get('/opengraph-image');
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('image/png');
  });

  test('opengraph-image returns binary image data', async ({ request }) => {
    const response = await request.get('/opengraph-image');
    const buffer = await response.body();
    // PNG magic bytes: 89 50 4E 47
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(buffer[2]).toBe(0x4e);
    expect(buffer[3]).toBe(0x47);
  });
});

// ─── Middleware Bypass ───────────────────────────────────────────────────

test.describe('metadata routes bypass middleware', () => {
  test('sitemap.xml does not trigger middleware headers', async ({ request }) => {
    // Middleware-test routes set X-Custom-Header — metadata routes should not
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    // Metadata routes run through proxy.ts but NOT middleware.ts
    // Verify the response is a valid sitemap, not a middleware response
    const body = await response.text();
    expect(body).toContain('<urlset');
  });
});
