/**
 * Sidebar default fallback — rendered when the current URL
 * doesn't match any page in the @sidebar slot.
 *
 * On hard navigation (full page load, URL bar), unmatched slots
 * render default.tsx. On soft navigation (Link click), unmatched
 * slots keep their current content.
 */
export default function SidebarDefault() {
  return (
    <div data-testid="sidebar-default">
      <h3>Sidebar: Default</h3>
      <p>Default sidebar content (no matching page).</p>
    </div>
  );
}
