import type { Metadata } from '@timber/app/server';

export const metadata: Metadata = {
  title: { absolute: 'Absolute Title' },
  description: 'Testing title.absolute skips template',
};

export default function AbsoluteTitlePage() {
  return (
    <div data-testid="meta-absolute-page">
      <h1 data-testid="meta-absolute-heading">Absolute Title Test</h1>
      <p>This page uses title.absolute to skip the layout template.</p>
    </div>
  );
}
