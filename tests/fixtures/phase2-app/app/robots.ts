/**
 * Dynamic robots.txt route for E2E testing.
 * See design/16-metadata.md §"Metadata Routes"
 */
export default async function robots() {
  return `User-agent: *
Allow: /
Disallow: /private/

Sitemap: https://example.com/sitemap.xml`;
}
