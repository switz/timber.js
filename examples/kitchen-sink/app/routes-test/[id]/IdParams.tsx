'use client';

import { useParams } from '@timber-js/app/client';

// Demonstrates the typed useParams() overload for /routes-test/[id].
// Codegen generates: useParams('/routes-test/[id]'): { id: string }
export default function IdParams() {
  const { id } = useParams('/routes-test/[id]');
  return (
    <span data-testid="use-params-value">
      <span data-testid="use-params-id">{id}</span>
    </span>
  );
}
