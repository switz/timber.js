/**
 * Server component page for the file-upload E2E fixture.
 */

import { getFormFlash } from '@timber/app/server';
import { UploadForm } from './form';

export default function FileUploadPage() {
  const flash = getFormFlash();

  return (
    <div data-testid="file-upload-page">
      <h1>File Upload Test</h1>
      <UploadForm flash={flash} />
    </div>
  );
}
