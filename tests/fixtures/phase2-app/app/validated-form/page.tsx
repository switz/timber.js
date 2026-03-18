/**
 * Server component page for the validated-form fixture.
 *
 * Reads form flash data (for no-JS validation error round-trip)
 * and passes it to the client form component.
 */

import { getFormFlash } from '@timber-js/app/server';
import { ContactForm } from './form';

export default function ValidatedFormPage() {
  const flash = getFormFlash();

  return (
    <div data-testid="validated-form-page">
      <h1>Contact Form</h1>
      <ContactForm flash={flash} />
    </div>
  );
}
