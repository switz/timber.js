/**
 * Chunk splitting tests — verify client bundle cache tier assignment.
 *
 * Tests the assignChunk function that splits client bundles into:
 * - vendor-react: react, react-dom, scheduler (stable across deploys)
 * - vendor-timber: timber runtime, RSC runtime (changes per framework update)
 * - vendor-app: user node_modules (changes on dependency updates)
 * - shared-app: small shared app modules (< 5KB, prevents micro-chunks)
 * - undefined: per-route page/layout chunks (default Rollup splitting)
 *
 * Also tests assignClientChunk for RSC facade grouping and that
 * timberChunks() targets only the client environment.
 *
 * Design docs: 27-chunking-strategy.md
 * Task: LOCAL-316
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  assignChunk,
  assignClientChunk,
  timberChunks,
} from '../packages/timber-app/src/plugins/chunks';

// ─── Test fixtures ───────────────────────────────────────────────────────
// Create temp files with known sizes to test size-based chunk assignment.

const FIXTURE_DIR = join(import.meta.dirname ?? __dirname, '.tmp-chunk-fixtures');

const smallFile = join(FIXTURE_DIR, 'src', 'utils', 'cn.ts');
const smallComponent = join(FIXTURE_DIR, 'src', 'components', 'Flex.tsx');
const largeComponent = join(FIXTURE_DIR, 'src', 'components', 'Dashboard.tsx');
const pageFile = join(FIXTURE_DIR, 'app', 'dashboard', 'page.tsx');
const layoutFile = join(FIXTURE_DIR, 'app', 'layout.tsx');
const loadingFile = join(FIXTURE_DIR, 'app', 'dashboard', 'loading.tsx');
const errorFile = join(FIXTURE_DIR, 'app', 'error.tsx');
const accessFile = join(FIXTURE_DIR, 'app', 'admin', 'access.ts');
const middlewareFile = join(FIXTURE_DIR, 'app', 'middleware.ts');
const smallClientComp = join(FIXTURE_DIR, 'src', 'components', 'Counter.tsx');

beforeAll(() => {
  // Create fixture files with specific sizes
  const dirs = [
    join(FIXTURE_DIR, 'src', 'utils'),
    join(FIXTURE_DIR, 'src', 'components'),
    join(FIXTURE_DIR, 'app', 'dashboard'),
    join(FIXTURE_DIR, 'app', 'admin'),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Small files (under 5KB threshold)
  writeFileSync(smallFile, 'export const cn = (...args) => args.join(" ");\n');
  writeFileSync(smallComponent, 'export function Flex() { return <div />; }\n');
  writeFileSync(smallClientComp, '"use client";\nexport function Counter() { return <div />; }\n');

  // Large file (over 5KB threshold)
  writeFileSync(largeComponent, 'x'.repeat(6000));

  // Route files (should NOT be merged into shared-app)
  writeFileSync(pageFile, 'export default function Page() { return <div />; }\n');
  writeFileSync(layoutFile, 'export default function Layout({ children }) { return children; }\n');
  writeFileSync(loadingFile, 'export default function Loading() { return <div />; }\n');
  writeFileSync(errorFile, '"use client";\nexport default function Error() { return <div />; }\n');
  writeFileSync(accessFile, 'export default function access() { return true; }\n');
  writeFileSync(middlewareFile, 'export function middleware() {}\n');
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

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

  // Tier 2b: Consumer-project timber paths (npm/pnpm install, not monorepo)

  it('assigns @timber-js/app consumer paths to vendor-timber', () => {
    expect(assignChunk('/project/node_modules/@timber-js/app/dist/client/router.js')).toBe(
      'vendor-timber'
    );
  });

  it('assigns @timber-js/app navigation-context to vendor-timber', () => {
    expect(
      assignChunk('/project/node_modules/@timber-js/app/dist/client/navigation-context.js')
    ).toBe('vendor-timber');
  });

  it('assigns @timber-js/app transition-root to vendor-timber', () => {
    expect(
      assignChunk('/project/node_modules/@timber-js/app/dist/client/transition-root.js')
    ).toBe('vendor-timber');
  });

  // Tier 3: User vendor libraries

  it('assigns user node_modules to vendor-app', () => {
    expect(assignChunk('/project/node_modules/lodash-es/index.js')).toBe('vendor-app');
  });

  it('assigns lucide-react to vendor-app', () => {
    expect(assignChunk('/project/node_modules/lucide-react/dist/icons.js')).toBe('vendor-app');
  });

  it('assigns framer-motion to vendor-app', () => {
    expect(assignChunk('/project/node_modules/framer-motion/dist/index.js')).toBe('vendor-app');
  });

  it('assigns scoped user packages to vendor-app', () => {
    expect(assignChunk('/project/node_modules/@radix-ui/react-dialog/dist/index.js')).toBe(
      'vendor-app'
    );
  });

  // Tier 4: Small shared app modules

  it('assigns small utility files to shared-app', () => {
    expect(assignChunk(smallFile)).toBe('shared-app');
  });

  it('assigns small components to shared-app', () => {
    expect(assignChunk(smallComponent)).toBe('shared-app');
  });

  it('does NOT assign large app files to shared-app', () => {
    expect(assignChunk(largeComponent)).toBeUndefined();
  });

  // Tier 5: Route files stay per-route (undefined = Rollup default)

  it('returns undefined for page.tsx', () => {
    expect(assignChunk(pageFile)).toBeUndefined();
  });

  it('returns undefined for layout.tsx', () => {
    expect(assignChunk(layoutFile)).toBeUndefined();
  });

  it('returns undefined for loading.tsx', () => {
    expect(assignChunk(loadingFile)).toBeUndefined();
  });

  it('returns undefined for error.tsx', () => {
    expect(assignChunk(errorFile)).toBeUndefined();
  });

  it('returns undefined for access.ts', () => {
    expect(assignChunk(accessFile)).toBeUndefined();
  });

  it('returns undefined for middleware.ts', () => {
    expect(assignChunk(middlewareFile)).toBeUndefined();
  });

  // Virtual modules (should not be assigned to shared-app)

  it('returns undefined for virtual modules with \\0 prefix', () => {
    expect(assignChunk('\0virtual:timber-browser-entry')).toBeUndefined();
  });

  it('returns undefined for relative paths (non-resolved)', () => {
    expect(assignChunk('src/components/Counter.tsx')).toBeUndefined();
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

  // Consumer-project timber paths (npm/pnpm install)

  it('groups @timber-js/app consumer paths into vendor-timber', () => {
    expect(
      assignClientChunk({
        id: '/project/node_modules/@timber-js/app/dist/client/navigation-context.js',
        normalizedId: 'node_modules/@timber-js/app/dist/client/navigation-context.js',
        serverChunk: 'facade:app/layout.tsx',
      })
    ).toBe('vendor-timber');
  });

  it('groups @timber-js/app link-status-provider into vendor-timber', () => {
    expect(
      assignClientChunk({
        id: '/project/node_modules/@timber-js/app/dist/client/link-status-provider.js',
        normalizedId: 'node_modules/@timber-js/app/dist/client/link-status-provider.js',
        serverChunk: 'facade:app/layout.tsx',
      })
    ).toBe('vendor-timber');
  });

  // Small user client components → shared-client (prevents facade micro-chunks)

  it('groups small user client components into shared-client', () => {
    expect(
      assignClientChunk({
        id: smallClientComp,
        normalizedId: 'src/components/Counter.tsx',
        serverChunk: 'facade:app/page.tsx',
      })
    ).toBe('shared-client');
  });

  // Large user client components → undefined (default per-route splitting)

  it('returns undefined for large user client components', () => {
    expect(
      assignClientChunk({
        id: largeComponent,
        normalizedId: 'src/components/Dashboard.tsx',
        serverChunk: 'facade:app/dashboard/page.tsx',
      })
    ).toBeUndefined();
  });

  // Third-party client components → undefined (handled by manualChunks vendor-app)

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
