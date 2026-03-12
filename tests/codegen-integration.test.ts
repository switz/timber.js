/**
 * Integration tests for generateRouteMap wired into the timber-routing plugin.
 *
 * Verifies that:
 * - buildStart writes timber-routes.d.ts and timber-env.d.ts
 * - File watcher rewrites timber-routes.d.ts on route changes
 * - The generated files have the expected content
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { timberRouting } from '../packages/timber-app/src/plugins/routing.js';
import type { PluginContext } from '../packages/timber-app/src/index.js';

const TMP_DIR = join(import.meta.dirname, '.tmp-codegen-integration-test');

function appDir(...segments: string[]): string {
  return join(TMP_DIR, 'app', ...segments);
}

function createFile(path: string, content = 'export default function() { return null }'): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function createApp(files: Record<string, string>): string {
  const root = appDir();
  mkdirSync(root, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    createFile(join(root, filePath), content);
  }
  return root;
}

function createPluginContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    config: { output: 'server', ...overrides.config },
    routeTree: null,
    appDir: appDir(),
    root: TMP_DIR,
    dev: false,
    buildManifest: null,
    ...overrides,
  };
}

/** Wait for async file writes (fire-and-forget) to settle. */
function waitForWrites(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('codegen-integration', () => {
  it('writes timber-routes.d.ts on buildStart', async () => {
    const root = createApp({
      'page.tsx': '',
      'dashboard/page.tsx': '',
    });

    const ctx = createPluginContext({ appDir: root });
    const plugin = timberRouting(ctx);

    const buildStart = plugin.buildStart as () => void;
    buildStart.call({});

    await waitForWrites();

    const routesPath = join(TMP_DIR, '.timber', 'timber-routes.d.ts');
    expect(existsSync(routesPath)).toBe(true);

    const content = readFileSync(routesPath, 'utf-8');
    expect(content).toContain('export {};');
    expect(content).toContain('declare module');
    expect(content).toContain("'/'");
    expect(content).toContain("'/dashboard'");
  });

  it('writes timber-env.d.ts on buildStart', async () => {
    const root = createApp({ 'page.tsx': '' });

    const ctx = createPluginContext({ appDir: root });
    const plugin = timberRouting(ctx);

    const buildStart = plugin.buildStart as () => void;
    buildStart.call({});

    await waitForWrites();

    const envPath = join(TMP_DIR, 'timber-env.d.ts');
    expect(existsSync(envPath)).toBe(true);

    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('/// <reference path=".timber/timber-routes.d.ts" />');
  });

  it('rewrites on file change', async () => {
    const root = createApp({ 'page.tsx': '' });

    const ctx = createPluginContext({ appDir: root });
    const plugin = timberRouting(ctx);

    // Capture the watcher callback so we can trigger it manually
    let addCallback: ((filePath: string) => void) | null = null;
    const mockServer = {
      watcher: {
        on: vi.fn((event: string, cb: (filePath: string) => void) => {
          if (event === 'add') addCallback = cb;
          return mockServer.watcher;
        }),
        add: vi.fn(),
      },
      environments: {},
      hot: { send: vi.fn(), on: vi.fn() },
    };

    const configureServer = plugin.configureServer as (server: unknown) => void;
    configureServer.call({}, mockServer);

    await waitForWrites();

    const routesPath = join(TMP_DIR, '.timber', 'timber-routes.d.ts');
    const contentBefore = readFileSync(routesPath, 'utf-8');
    expect(contentBefore).not.toContain("'/new-route'");

    // Add a new route file on disk and simulate the watcher firing
    createFile(join(root, 'new-route', 'page.tsx'), '');
    addCallback!(join(root, 'new-route', 'page.tsx'));

    await waitForWrites();

    const contentAfter = readFileSync(routesPath, 'utf-8');
    expect(contentAfter).toContain("'/new-route'");
  });

  it('includes dynamic route params in generated types', async () => {
    const root = createApp({
      'products/[id]/page.tsx': '',
    });

    const ctx = createPluginContext({ appDir: root });
    const plugin = timberRouting(ctx);

    const buildStart = plugin.buildStart as () => void;
    buildStart.call({});

    await waitForWrites();

    const content = readFileSync(join(TMP_DIR, '.timber', 'timber-routes.d.ts'), 'utf-8');
    expect(content).toContain("'/products/[id]'");
    expect(content).toContain('id: string');
  });

  it('includes search-params reference when search-params.ts exists', async () => {
    const root = createApp({
      'products/page.tsx': '',
      'products/search-params.ts': 'export default createSearchParams({})',
    });

    const ctx = createPluginContext({ appDir: root });
    const plugin = timberRouting(ctx);

    const buildStart = plugin.buildStart as () => void;
    buildStart.call({});

    await waitForWrites();

    const content = readFileSync(join(TMP_DIR, '.timber', 'timber-routes.d.ts'), 'utf-8');
    expect(content).toContain('search-params');
  });
});
