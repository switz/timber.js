export const metadata = { title: 'Nested Layouts' };

export default function NestedIndexPage() {
  return (
    <div data-testid="nested-index-page">
      <p className="text-sm text-stone-700">
        This is the index page inside the outer layout. Navigate to &ldquo;Section&rdquo; to see a second layout layer.
      </p>
    </div>
  );
}
