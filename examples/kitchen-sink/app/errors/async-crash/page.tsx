// Throws an unhandled error in an async server component — caught by root error.tsx.
// This tests the async error path (RSC onError callback + SSR failure → renderErrorPage).
// The sync variant is in errors/crash/page.tsx.
export default async function AsyncCrashPage() {
  await Promise.resolve();
  throw new Error('Intentional async crash for E2E testing');
}
