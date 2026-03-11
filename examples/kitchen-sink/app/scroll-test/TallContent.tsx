/**
 * Renders a tall block to make pages scrollable for scroll-restoration E2E tests.
 * Each section has a data-testid so tests can scroll to specific positions.
 */
export default function TallContent({ id }: { id: string }) {
  return (
    <div data-testid={`tall-content-${id}`}>
      {Array.from({ length: 20 }, (_, i) => (
        <div
          key={i}
          data-testid={`section-${id}-${i}`}
          style={{
            height: '200px',
            padding: '16px',
            borderBottom: '1px solid #ddd',
            background: i % 2 === 0 ? '#f9f9f9' : '#fff',
          }}
        >
          <p>
            {id} — Section {i}
          </p>
        </div>
      ))}
    </div>
  );
}
