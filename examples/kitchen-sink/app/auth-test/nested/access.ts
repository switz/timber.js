import type { AccessContext } from '@timber/app/server';

// Parent access gate — always passes.
// Tests that parent access runs first (top-down) and child still executes.
export default async function access(_ctx: AccessContext) {
  // pass — no deny or redirect
}
