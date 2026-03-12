import { RedirectForm } from './redirect-form';

export default function ActionRedirectTestPage() {
  return (
    <div>
      <h1 data-testid="redirect-test-heading">Action Redirect Test</h1>
      <p>Submitting this form triggers a server action that calls redirect().</p>
      <RedirectForm />
    </div>
  );
}
