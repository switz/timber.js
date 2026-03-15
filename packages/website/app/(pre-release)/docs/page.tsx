// Redirect is handled by middleware.ts — this page is never rendered.
// The file exists to register the /docs route in the router.
export default function DocsIndex() {
  return null;
}
