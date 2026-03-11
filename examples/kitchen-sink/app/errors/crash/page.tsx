// Throws an unhandled error — caught by root error.tsx.
// Per design/10-error-handling.md, this produces HTTP 500 with error.tsx rendered.
export default function CrashPage() {
  throw new Error('Intentional crash for E2E testing');
}
