/**
 * Test page that always calls deny(404).
 * Used to verify that deny() in async server components produces correct HTTP status codes.
 */
import { deny } from '@timber-js/app/server';

export default async function DenyTestPage() {
  // Simulate async work (e.g. fetching a resource that doesn't exist)
  await Promise.resolve();
  deny(404);
}
