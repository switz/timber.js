import { getFormFlash } from '@timber-js/app/server';
import { EventForm } from './event-form';

export const metadata = { title: 'Forms' };

export default function FormsPage() {
  const flash = getFormFlash();

  return (
    <div data-testid="forms-page">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Forms</h1>
      <p className="text-stone-500 text-sm mb-6">
        Validated form with coercion, progressive enhancement, and no-JS error round-trip.
      </p>
      <EventForm flash={flash} />
    </div>
  );
}
