/**
 * Chunk plugin tests — verify the timber-chunks plugin configuration.
 *
 * After LOCAL-337, manual chunk splitting was removed. Rolldown handles
 * natural code splitting (per-route chunks only). The timber-chunks plugin
 * is now a minimal no-op retained as a hook point for future adjustments.
 *
 * This test verifies:
 * - The plugin has the correct name
 * - No manualChunks configuration is applied
 * - isTimberRuntime correctly identifies timber framework modules
 *
 * Design docs: 27-chunking-strategy.md
 * Task: LOCAL-337 (simplified from LOCAL-316)
 */

import { describe, it, expect } from 'vitest';
import { isTimberRuntime, timberChunks } from '../packages/timber-app/src/plugins/chunks';

// ─── isTimberRuntime ─────────────────────────────────────────────────────

describe('isTimberRuntime', () => {
  it('matches monorepo timber-app paths', () => {
    expect(isTimberRuntime('/project/packages/timber-app/src/client/router.ts')).toBe(true);
    expect(isTimberRuntime('/project/packages/timber-app/src/client/navigation-context.ts')).toBe(
      true
    );
  });

  it('matches consumer @timber-js/app paths', () => {
    expect(
      isTimberRuntime('/project/node_modules/@timber-js/app/dist/client/router.js')
    ).toBe(true);
    expect(
      isTimberRuntime('/project/node_modules/@timber-js/app/dist/client/navigation-context.js')
    ).toBe(true);
  });

  it('matches react-server-dom packages', () => {
    expect(
      isTimberRuntime('/project/node_modules/react-server-dom-webpack/client.js')
    ).toBe(true);
  });

  it('matches @vitejs/plugin-rsc runtime', () => {
    expect(
      isTimberRuntime('/project/node_modules/@vitejs/plugin-rsc/runtime/client.js')
    ).toBe(true);
  });

  it('does NOT match react', () => {
    expect(isTimberRuntime('/project/node_modules/react/index.js')).toBe(false);
  });

  it('does NOT match user app code', () => {
    expect(isTimberRuntime('/project/app/page.tsx')).toBe(false);
    expect(isTimberRuntime('/project/src/components/Counter.tsx')).toBe(false);
  });

  it('does NOT match user node_modules', () => {
    expect(isTimberRuntime('/project/node_modules/lodash-es/index.js')).toBe(false);
  });
});

// ─── timberChunks plugin ─────────────────────────────────────────────────

describe('timberChunks', () => {
  it('returns a plugin with name timber-chunks', () => {
    const plugin = timberChunks();
    expect(plugin.name).toBe('timber-chunks');
  });

  it('does NOT set manualChunks (natural code splitting)', () => {
    const plugin = timberChunks();
    // The plugin should not have a config hook that sets manualChunks
    expect(plugin.config).toBeUndefined();
  });
});
