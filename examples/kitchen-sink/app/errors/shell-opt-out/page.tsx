import { deny } from '@timber-js/app/server';

// Test page that triggers deny(401) in a segment with shell=false status file.
export default function ShellOptOutTest() {
  deny(401);
  return null;
}
