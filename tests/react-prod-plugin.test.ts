/**
 * Tests for the timber-react-prod plugin.
 *
 * Verifies that React CJS development bundles are redirected to production
 * bundles during production builds, preventing dev React from shipping to users.
 *
 * Task: TIM-289
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { timberReactProd } from '../packages/timber-app/src/plugins/react-prod';

function createPlugin() {
  const plugin = timberReactProd();
  const handler =
    typeof plugin.resolveId === 'object' ? plugin.resolveId.handler : plugin.resolveId;
  return { plugin, handler };
}

function activatePlugin(plugin: ReturnType<typeof timberReactProd>, mode = 'production') {
  const configResolved = plugin.configResolved as (config: unknown) => void;
  configResolved({ command: 'build', mode });
}

describe('timber-react-prod plugin', () => {
  it('has correct name and enforce', () => {
    const { plugin } = createPlugin();
    expect(plugin.name).toBe('timber-react-prod');
    expect(plugin.enforce).toBe('pre');
  });

  describe('in production mode', () => {
    let handler: any;
    let resolveResult: { id: string; external: boolean };
    let mockContext: any;

    beforeEach(() => {
      const created = createPlugin();
      handler = created.handler;
      activatePlugin(created.plugin, 'production');
      resolveResult = { id: '', external: false };
      mockContext = {
        resolve: vi.fn(async () => resolveResult),
      };
    });

    it('rewrites react/cjs/*.development.js to *.production.js', async () => {
      resolveResult.id = '/node_modules/react/cjs/react.development.js';
      const result = await handler.call(mockContext, './cjs/react.development.js', '/node_modules/react/index.js', { attributes: {}, isEntry: false });
      expect(result.id).toBe('/node_modules/react/cjs/react.production.js');
    });

    it('rewrites react-dom/cjs/*.development.js to *.production.js', async () => {
      resolveResult.id = '/node_modules/react-dom/cjs/react-dom-client.development.js';
      const result = await handler.call(mockContext, './cjs/react-dom-client.development.js', '/node_modules/react-dom/client.js', {});
      expect(result.id).toBe('/node_modules/react-dom/cjs/react-dom-client.production.js');
    });

    it('rewrites scheduler/cjs/*.development.js to *.production.js', async () => {
      resolveResult.id = '/node_modules/scheduler/cjs/scheduler.development.js';
      const result = await handler.call(mockContext, './cjs/scheduler.development.js', '/node_modules/scheduler/index.js', {});
      expect(result.id).toBe('/node_modules/scheduler/cjs/scheduler.production.js');
    });

    it('rewrites react-server-dom vendored CJS to production', async () => {
      resolveResult.id = '/node_modules/@vitejs/plugin-rsc/dist/vendor/react-server-dom/cjs/react-server-dom-webpack-client.browser.development.js';
      const result = await handler.call(mockContext, './cjs/react-server-dom-webpack-client.browser.development.js', '/some/importer.js', {});
      expect(result.id).toBe('/node_modules/@vitejs/plugin-rsc/dist/vendor/react-server-dom/cjs/react-server-dom-webpack-client.browser.production.js');
    });

    it('ignores non-development imports', async () => {
      const result = await handler.call(mockContext, 'react', '/app/page.tsx', {});
      expect(result).toBeUndefined();
      expect(mockContext.resolve).not.toHaveBeenCalled();
    });

    it('ignores development files outside react packages', async () => {
      resolveResult.id = '/node_modules/some-lib/cjs/lib.development.js';
      const result = await handler.call(mockContext, './cjs/lib.development.js', '/node_modules/some-lib/index.js', {});
      expect(result).toBeUndefined();
    });

    it('does nothing when resolve returns null', async () => {
      mockContext.resolve = vi.fn(async () => null);
      const result = await handler.call(mockContext, './cjs/react.development.js', '/node_modules/react/index.js', { attributes: {}, isEntry: false });
      expect(result).toBeUndefined();
    });
  });

  describe('in development mode', () => {
    it('does nothing', async () => {
      const { plugin, handler } = createPlugin();
      activatePlugin(plugin, 'development');
      const mockContext = { resolve: vi.fn() } as any;
      const result = await handler!.call(mockContext, './cjs/react.development.js', '/node_modules/react/index.js', { attributes: {}, isEntry: false });
      expect(result).toBeUndefined();
      expect(mockContext.resolve).not.toHaveBeenCalled();
    });
  });

  describe('in serve mode', () => {
    it('does nothing', async () => {
      const { plugin, handler } = createPlugin();
      (plugin.configResolved as (config: unknown) => void)({ command: 'serve', mode: 'development' });
      const mockContext = { resolve: vi.fn() } as any;
      const result = await handler!.call(mockContext, './cjs/react.development.js', '/node_modules/react/index.js', { attributes: {}, isEntry: false });
      expect(result).toBeUndefined();
      expect(mockContext.resolve).not.toHaveBeenCalled();
    });
  });
});
