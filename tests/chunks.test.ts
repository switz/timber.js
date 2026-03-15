/**
 * Chunk splitting tests — verify client bundle cache tier assignment.
 *
 * Tests the assignChunk function that splits client bundles into:
 * - vendor-react: react, react-dom, scheduler (stable across deploys)
 * - vendor-timber: timber runtime, RSC runtime (changes per framework update)
 * - undefined: app code (default Rollup splitting)
 *
 * Also tests that timberChunks() targets only the client environment.
 *
 * Design docs: 27-chunking-strategy.md
 * Task: TIM-338
 */

import { describe, it, expect } from 'vitest';
import {
  assignChunk,
  assignClientChunk,
  timberChunks,
} from '../packages/timber-app/src/plugins/chunks';

// ─── assignChunk ─────────────────────────────────────────────────────────

describe('assignChunk', () => {
  // Tier 1: React vendor chunk

  it('assigns react to vendor-react', () => {
    expect(assignChunk('/project/node_modules/react/index.js')).toBe('vendor-react');
  });

  it('assigns react-dom to vendor-react', () => {
    expect(assignChunk('/project/node_modules/react-dom/client.js')).toBe('vendor-react');
  });

  it('assigns scheduler to vendor-react', () => {
    expect(assignChunk('/project/node_modules/scheduler/index.js')).toBe('vendor-react');
  });

  it('does not assign react-server-dom to vendor-react', () => {
    // react-server-dom is timber runtime tier, not the react vendor tier
    expect(assignChunk('/project/node_modules/react-server-dom-webpack/client.js')).not.toBe(
      'vendor-react'
    );
  });

  // Tier 2: timber runtime chunk

  it('assigns timber-app modules to vendor-timber', () => {
    expect(assignChunk('/project/packages/timber-app/src/client/router.ts')).toBe('vendor-timber');
  });

  it('assigns react-server-dom to vendor-timber', () => {
    expect(assignChunk('/project/node_modules/react-server-dom-webpack/client.js')).toBe(
      'vendor-timber'
    );
  });

  it('assigns @vitejs/plugin-rsc runtime to vendor-timber', () => {
    expect(assignChunk('/project/node_modules/@vitejs/plugin-rsc/runtime/client.js')).toBe(
      'vendor-timber'
    );
  });

  // Tier 3: App code (undefined = Rollup default splitting)

  it('returns undefined for app page components', () => {
    expect(assignChunk('/project/app/dashboard/page.tsx')).toBeUndefined();
  });

  it('returns undefined for app layout components', () => {
    expect(assignChunk('/project/app/layout.tsx')).toBeUndefined();
  });

  it('returns undefined for third-party libraries', () => {
    expect(assignChunk('/project/node_modules/lodash-es/index.js')).toBeUndefined();
  });

  it('returns undefined for user client components', () => {
    expect(assignChunk('/project/src/components/Counter.tsx')).toBeUndefined();
  });
});

// ─── assignClientChunk ───────────────────────────────────────────────────
// The RSC plugin creates separate entry points for each 'use client' module.
// manualChunks can't merge entry points, so assignClientChunk groups timber's
// internal client components via the RSC plugin's clientChunks callback.

describe('assignClientChunk', () => {
  // Timber internal 'use client' modules → grouped into vendor-timber

  it('groups segment-context into vendor-timber', () => {
    expect(
      assignClientChunk({
        id: '/project/packages/timber-app/src/client/segment-context.ts',
        normalizedId: 'packages/timber-app/src/client/segment-context.ts',
        serverChunk: 'facade:app/layout.tsx',
      })
    ).toBe('vendor-timber');
  });

  it('groups error-boundary into vendor-timber', () => {
    expect(
      assignClientChunk({
        id: '/project/packages/timber-app/src/client/error-boundary.tsx',
        normalizedId: 'packages/timber-app/src/client/error-boundary.tsx',
        serverChunk: 'facade:app/layout.tsx',
      })
    ).toBe('vendor-timber');
  });

  it('groups link-navigate-interceptor into vendor-timber', () => {
    expect(
      assignClientChunk({
        id: '/project/packages/timber-app/src/client/link-navigate-interceptor.tsx',
        normalizedId: 'packages/timber-app/src/client/link-navigate-interceptor.tsx',
        serverChunk: 'facade:app/layout.tsx',
      })
    ).toBe('vendor-timber');
  });

  it('groups nuqs-adapter into vendor-timber', () => {
    expect(
      assignClientChunk({
        id: '/project/packages/timber-app/src/client/nuqs-adapter.tsx',
        normalizedId: 'packages/timber-app/src/client/nuqs-adapter.tsx',
        serverChunk: 'facade:app/layout.tsx',
      })
    ).toBe('vendor-timber');
  });

  // User app client components → undefined (default per-route splitting)

  it('returns undefined for user client components', () => {
    expect(
      assignClientChunk({
        id: '/project/app/components/Counter.tsx',
        normalizedId: 'app/components/Counter.tsx',
        serverChunk: 'facade:app/page.tsx',
      })
    ).toBeUndefined();
  });

  it('returns undefined for third-party client components', () => {
    expect(
      assignClientChunk({
        id: '/project/node_modules/some-lib/Button.tsx',
        normalizedId: 'node_modules/some-lib/Button.tsx',
        serverChunk: 'shared:node_modules/some-lib/Button.tsx',
      })
    ).toBeUndefined();
  });
});

// ─── timberChunks plugin ─────────────────────────────────────────────────

describe('timberChunks', () => {
  it('returns a plugin with name timber-chunks', () => {
    const plugin = timberChunks();
    expect(plugin.name).toBe('timber-chunks');
  });

  it('config hook targets only client environment', () => {
    const plugin = timberChunks();
    const configHook = plugin.config as () => Record<string, unknown>;
    const result = configHook() as {
      environments: {
        client: { build: { rollupOptions: { output: { manualChunks: unknown } } } };
      };
    };

    // Should have environments.client but NOT rsc or ssr
    expect(result.environments.client).toBeDefined();
    expect(result.environments.client.build.rollupOptions.output.manualChunks).toBe(assignChunk);
    expect((result.environments as Record<string, unknown>)['rsc']).toBeUndefined();
    expect((result.environments as Record<string, unknown>)['ssr']).toBeUndefined();
  });
});
