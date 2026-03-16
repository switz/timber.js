/**
 * Dynamic sitemap route for E2E testing.
 * See design/16-metadata.md §"Metadata Routes"
 */
export default async function sitemap() {
  return [
    {
      url: 'https://example.com/',
      lastModified: '2024-01-01',
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: 'https://example.com/about',
      lastModified: '2024-01-02',
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];
}
