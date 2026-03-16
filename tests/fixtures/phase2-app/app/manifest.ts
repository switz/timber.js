/**
 * Dynamic web manifest route for E2E testing.
 * See design/16-metadata.md §"Metadata Routes"
 */
export default async function manifest() {
  return {
    name: 'Timber Test App',
    short_name: 'Timber',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#000000',
  };
}
