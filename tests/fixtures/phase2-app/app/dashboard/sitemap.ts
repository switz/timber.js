/**
 * Nested sitemap for dashboard — tests nestable metadata routes.
 * See design/16-metadata.md §"Metadata Routes"
 */
export default async function sitemap() {
  return [
    {
      url: 'https://example.com/dashboard',
      lastModified: '2024-03-01',
      priority: 0.9,
    },
    {
      url: 'https://example.com/dashboard/settings',
      lastModified: '2024-03-01',
      priority: 0.7,
    },
  ];
}
