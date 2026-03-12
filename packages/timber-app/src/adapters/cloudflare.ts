// Cloudflare Workers adapter
//
// Primary deployment target. Generates a Workers-compatible entry point
// and wrangler.jsonc configuration. See design/11-platform.md §"Cloudflare Workers".

import { writeFile, mkdir, cp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, relative } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TimberPlatformAdapter, TimberConfig } from './types';

// ─── Bindings passthrough ─────────────────────────────────────────────────
// ALS stores the env object per-request so server components and middleware
// can access KV, D1, DO, R2, Queues, etc. via getCloudflareBindings().
// No global fallback — if called outside a request, it throws.
// See design/11-platform.md §"Platform Target" and design/25-production-deployments.md.

const bindingsAls = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * Get Cloudflare Worker bindings for the current request.
 *
 * Returns the `env` object passed to the Worker's `fetch` handler,
 * giving direct access to KV, D1, Durable Objects, R2, Queues, and
 * any other bindings configured in `wrangler.jsonc`.
 *
 * Must be called within a request context (server component, middleware,
 * server action). Throws outside a request.
 *
 * @example
 * ```ts
 * import { getCloudflareBindings } from '@timber/app/adapters/cloudflare'
 *
 * export default async function Page() {
 *   const { MY_KV, MY_DB } = getCloudflareBindings()
 *   const data = await MY_KV.get('key')
 *   return <div>{data}</div>
 * }
 * ```
 */
export function getCloudflareBindings<
  T extends Record<string, unknown> = Record<string, unknown>,
>(): T {
  const env = bindingsAls.getStore();
  if (!env) {
    throw new Error(
      'getCloudflareBindings() called outside a Cloudflare Workers request context. ' +
        'It can only be called from server components, middleware, or server actions ' +
        'when running on the Cloudflare adapter.'
    );
  }
  return env as T;
}

/**
 * Run a function with Cloudflare bindings available via getCloudflareBindings().
 * @internal Used by wrapWithExecutionContext.
 */
export function runWithBindings<T>(env: Record<string, unknown>, fn: () => T): T {
  return bindingsAls.run(env, fn);
}

/** Options for the Cloudflare Workers adapter. */
export interface CloudflareAdapterOptions {
  /**
   * Cloudflare compatibility date.
   * @default Current date in YYYY-MM-DD format at build time.
   */
  compatibilityDate?: string;

  /**
   * Additional compatibility flags.
   * @default ['nodejs_compat']
   */
  compatibilityFlags?: string[];

  /**
   * Custom wrangler.jsonc fields to merge.
   * Overrides generated values.
   */
  wrangler?: Record<string, unknown>;
}

/**
 * Create a Cloudflare Workers adapter.
 *
 * @example
 * ```ts
 * import { cloudflare } from '@timber/app/adapters/cloudflare'
 *
 * export default {
 *   output: 'server',
 *   adapter: cloudflare(),
 * }
 * ```
 */
export function cloudflare(options: CloudflareAdapterOptions = {}): TimberPlatformAdapter {
  return {
    name: 'cloudflare',

    async buildOutput(config: TimberConfig, buildDir: string) {
      const outDir = join(buildDir, 'cloudflare');
      await mkdir(outDir, { recursive: true });

      // Copy client assets to static output
      const clientDir = join(buildDir, 'client');
      const staticDir = join(outDir, 'static');
      await mkdir(staticDir, { recursive: true });
      await cp(clientDir, staticDir, { recursive: true }).catch(() => {
        // Client dir may not exist in noClientJavascript mode
      });

      // Generate the Workers entry point
      const workerEntry = generateWorkerEntry(buildDir, outDir);
      await writeFile(join(outDir, '_worker.ts'), workerEntry);

      // Generate wrangler.jsonc
      const wranglerConfig = generateWranglerConfig(config, options);
      await writeFile(join(outDir, 'wrangler.jsonc'), JSON.stringify(wranglerConfig, null, 2));
    },

    async preview(_config: TimberConfig, buildDir: string) {
      const cmd = generatePreviewCommand(buildDir);
      await spawnPreviewProcess(cmd.command, cmd.args, cmd.cwd);
    },

    // Default no-op. wrapWithExecutionContext() replaces this per-request
    // with a function that routes to ctx.waitUntil().
    waitUntil(_promise: Promise<unknown>) {},
  };
}

/**
 * Wrap a timber request handler to bind the Cloudflare execution context
 * for `waitUntil()` support and env bindings passthrough.
 * Called from the generated worker entry.
 *
 * This function:
 * 1. Binds `adapter.waitUntil()` to `ctx.waitUntil()` per-request
 * 2. Makes `env` accessible via `getCloudflareBindings()` per-request via ALS
 */
export function wrapWithExecutionContext(
  adapter: TimberPlatformAdapter,
  handler: (req: Request) => Promise<Response>
): ExportedHandler<Record<string, unknown>> {
  return {
    async fetch(
      request: Request,
      env: Record<string, unknown>,
      ctx: ExecutionContext
    ): Promise<Response> {
      // Bind the adapter's waitUntil to the Workers execution context
      const originalWaitUntil = adapter.waitUntil;
      adapter.waitUntil = (promise: Promise<unknown>) => {
        ctx.waitUntil(promise);
      };

      try {
        // Run the handler within ALS so getCloudflareBindings() works
        return await runWithBindings(env, () => handler(request));
      } finally {
        // Restore (in case adapter is reused across isolate resets)
        adapter.waitUntil = originalWaitUntil;
      }
    },
  };
}

// ─── Exported helpers (used by tests and build) ─────────────────────────────

/** @internal Exported for testing. */
export function generateWorkerEntry(buildDir: string, outDir: string): string {
  const serverEntryRelative = relative(outDir, join(buildDir, 'server', 'entry.js'));

  return `// Generated by @timber/app/adapters/cloudflare
// Do not edit — this file is regenerated on each build.

import { wrapWithExecutionContext } from '@timber/app/adapters/cloudflare'
import { handler, adapter } from '${serverEntryRelative}'

// Set TIMBER_RUNTIME for instrumentation.ts conditional SDK initialization.
// See design/25-production-deployments.md §"TIMBER_RUNTIME".
globalThis.process ??= { env: {} }
process.env.TIMBER_RUNTIME = 'cloudflare'

export default wrapWithExecutionContext(adapter, handler)
`;
}

/** @internal Exported for testing. */
export function generateWranglerConfig(
  config: TimberConfig,
  options: CloudflareAdapterOptions
): Record<string, unknown> {
  const compatDate = options.compatibilityDate ?? new Date().toISOString().slice(0, 10);

  const flags = options.compatibilityFlags ?? ['nodejs_compat'];

  const base: Record<string, unknown> = {
    name: 'timber-app',
    main: '_worker.ts',
    compatibility_date: compatDate,
    compatibility_flags: flags,
    assets: {
      directory: './static',
    },
  };

  // Merge user overrides
  if (options.wrangler) {
    return { ...base, ...options.wrangler };
  }

  return base;
}

// ─── Preview ─────────────────────────────────────────────────────────────────

/** Command descriptor for preview — testable without spawning a process. */
export interface PreviewCommand {
  command: string;
  args: string[];
  cwd: string;
}

/** @internal Exported for testing. */
export function generatePreviewCommand(buildDir: string): PreviewCommand {
  const cfDir = join(buildDir, 'cloudflare');
  return {
    command: 'wrangler',
    args: ['dev', '--local', '--config', join(cfDir, 'wrangler.jsonc')],
    cwd: cfDir,
  };
}

/**
 * Spawn a long-running preview process and pipe stdio to the parent.
 * Resolves when the process exits.
 */
function spawnPreviewProcess(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = execFile(command, args, { cwd }, (err) => {
      if (err) reject(err);
      else resolve();
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

// ─── Cloudflare Workers type stubs ───────────────────────────────────────────
// Minimal type declarations so this file compiles without @cloudflare/workers-types.
// In production builds, users install @cloudflare/workers-types themselves.

declare global {
  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
  }

  interface ExportedHandler<Env = Record<string, unknown>> {
    fetch?(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response;
  }
}
