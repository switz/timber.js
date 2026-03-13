/**
 * timber-adapter-build — Invoke the adapter's buildOutput after vite build.
 *
 * After all environments are built and the RSC plugin has written its
 * asset manifests, calls `adapter.buildOutput()` to transform the output
 * into a deployable artifact (e.g., Cloudflare Workers entry + wrangler.jsonc).
 *
 * Uses a `buildApp` hook with `order: 'post'` so that Vite calls the
 * RSC plugin's buildApp (which orchestrates all environment builds and
 * writes asset manifests) first, then runs this handler after everything
 * is complete.
 *
 * Design docs: design/11-platform.md, design/25-production-deployments.md
 */

import type { Plugin } from 'vite';
import { join } from 'node:path';
import type { PluginContext } from '../index.js';
import type { TimberPlatformAdapter, TimberConfig } from '../adapters/types.js';

export function timberAdapterBuild(ctx: PluginContext): Plugin {
  return {
    name: 'timber-adapter-build',

    // order: 'post' causes Vite to run configBuilder.buildApp() (which
    // includes the RSC plugin's buildApp) before calling this handler.
    // By the time we run, all environments are built and asset manifests
    // are written — safe to copy the output.
    buildApp: {
      order: 'post' as const,
      async handler() {
        if (ctx.dev) return;

        const adapter = ctx.config.adapter as TimberPlatformAdapter | undefined;
        if (!adapter || typeof adapter.buildOutput !== 'function') return;

        const buildDir = join(ctx.root, 'dist');
        const adapterConfig: TimberConfig = {
          output: ctx.config.output ?? 'server',
          noClientJavascript: ctx.config.noClientJavascript,
        };

        await adapter.buildOutput(adapterConfig, buildDir);
      },
    },
  };
}
