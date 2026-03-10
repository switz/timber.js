/**
 * About page — main content area.
 * Route: /parallel/about
 *
 * The @sidebar slot has no matching page for /about,
 * so it should render default.tsx on hard navigation.
 */
export default function AboutPage() {
  return (
    <div data-testid="parallel-about-content">
      <h2>About Content</h2>
      <p>Main content area — about. Sidebar should show default.</p>
    </div>
  );
}
