import type { Plugin, PluginOption } from 'vite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { cacheTransformPlugin } from './plugins/cache-transform';
import { timberContent } from './plugins/content';
import { timberDevServer } from './plugins/dev-server';
import { timberEntries } from './plugins/entries';
import { timberMdx } from './plugins/mdx';
import { timberRouting } from './plugins/routing';
import { timberShims } from './plugins/shims';
import { timberFonts } from './plugins/fonts';
import { timberStaticBuild } from './plugins/static-build';
import { timberDynamicTransform } from './plugins/dynamic-transform';
import { timberServerActionExports } from './plugins/server-action-exports';
import { timberBuildManifest } from './plugins/build-manifest';
import { timberDevLogs } from './plugins/dev-logs';
import { timberReactProd } from './plugins/react-prod';
import { timberChunks, assignClientChunk } from './plugins/chunks';
import { timberServerBundle } from './plugins/server-bundle';
import { timberAdapterBuild } from './plugins/adapter-build';
import { timberBuildReport } from './plugins/build-report';
import type { RouteTree } from './routing/types';
import type { BuildManifest } from './server/build-manifest';
import type { StartupTimer } from './utils/startup-timer';
import { createStartupTimer, createNoopTimer } from './utils/startup-timer';

/** Configuration for client-side JavaScript output. */
export interface ClientJavascriptConfig {
  /** When true, no client JS bundles are emitted or referenced in HTML. */
  disabled: boolean;
  /**
   * When `disabled` is true, still inject the Vite HMR client in dev mode
   * so hot reloading works during development. Default: true.
   */
  enableHMRInDev?: boolean;
}

/** Fully resolved client JavaScript configuration (no optionals). */
export interface ResolvedClientJavascript {
  disabled: boolean;
  enableHMRInDev: boolean;
}

export interface TimberUserConfig {
  output?: 'server' | 'static';
  /**
   * Control client-side JavaScript output.
   *
   * Boolean shorthand:
   *   `clientJavascript: false` disables all client JS (equivalent to `{ disabled: true }`).
   *   `clientJavascript: true` enables client JS (the default).
   *
   * Object form:
   *   `clientJavascript: { disabled: true, enableHMRInDev: true }` disables client JS
   *   in production but preserves Vite HMR in dev mode.
   *
   * When `disabled` is true, `enableHMRInDev` defaults to `true`.
   * Server-side JS still runs — this only affects what is sent to the browser.
   */
  clientJavascript?: boolean | ClientJavascriptConfig;
  /**
   * @deprecated Use `clientJavascript: false` or `clientJavascript: { disabled: true }` instead.
   *
   * Disable all client-side JavaScript output. When true, no client JS
   * bundles are emitted or referenced in HTML. Pages work entirely via
   * server-rendered HTML. Works in both 'server' and 'static' modes.
   *
   * Server-side JS still runs — this only affects what is sent to the browser.
   */
  noClientJavascript?: boolean;
  adapter?: unknown;
  cacheHandler?: unknown;
  allowedOrigins?: string[];
  csrf?: boolean;
  limits?: {
    actionBodySize?: string;
    uploadBodySize?: string;
    maxFields?: number;
  };
  pageExtensions?: string[];
  /** Dev-mode options. These have no effect in production builds. */
  dev?: {
    /** Threshold in ms to highlight slow phases in dev logging output. Default: 200. */
    slowPhaseMs?: number;
  };
  /**
   * Cookie signing configuration. See design/29-cookies.md §"Signed Cookies".
   *
   * Provide `secret` for a single key, or `secrets` (array) for key rotation.
   * When `secrets` is used, index 0 is the signing key; all are tried for verification.
   */
  cookies?: {
    /** Single signing secret. Shorthand for `secrets: [secret]`. */
    secret?: string;
    /** Array of signing secrets for key rotation. Index 0 signs; all verify. */
    secrets?: string[];
  };
  /** MDX compilation options passed to @mdx-js/rollup. See design/20-content-collections.md. */
  mdx?: {
    remarkPlugins?: unknown[];
    rehypePlugins?: unknown[];
    recmaPlugins?: unknown[];
    remarkRehypeOptions?: Record<string, unknown>;
  };
}

/**
 * Resolve `clientJavascript` (new) and `noClientJavascript` (deprecated) into
 * a fully resolved config. Emits a deprecation warning for the old option.
 */
export function resolveClientJavascript(config: TimberUserConfig): ResolvedClientJavascript {
  // New option takes precedence over deprecated option
  if (config.clientJavascript !== undefined) {
    if (typeof config.clientJavascript === 'boolean') {
      // `clientJavascript: false` → disabled
      // `clientJavascript: true` → enabled (default)
      return {
        disabled: !config.clientJavascript,
        enableHMRInDev: !config.clientJavascript, // default true when disabled
      };
    }
    // Object form
    return {
      disabled: config.clientJavascript.disabled,
      enableHMRInDev: config.clientJavascript.enableHMRInDev ?? config.clientJavascript.disabled,
    };
  }

  // Fall back to deprecated noClientJavascript
  if (config.noClientJavascript !== undefined) {
    console.warn(
      '[timber] `noClientJavascript` is deprecated. ' +
        'Use `clientJavascript: false` or `clientJavascript: { disabled: true, enableHMRInDev: true }` instead.'
    );
    return {
      disabled: config.noClientJavascript,
      enableHMRInDev: config.noClientJavascript, // default true when disabled
    };
  }

  // Default: client JS enabled
  return { disabled: false, enableHMRInDev: false };
}

/**
 * Shared context object passed to all sub-plugins via closure.
 *
 * Sub-plugins communicate through this context — not through Vite's
 * plugin API or global state.
 * See design/18-build-system.md §"Shared Plugin Context".
 */
export interface PluginContext {
  config: TimberUserConfig;
  /** Resolved client JavaScript configuration */
  clientJavascript: ResolvedClientJavascript;
  /** The scanned route tree (populated by timber-routing, consumed by timber-entries) */
  routeTree: RouteTree | null;
  /** Absolute path to the app/ directory */
  appDir: string;
  /** Absolute path to the project root */
  root: string;
  /** Whether the dev server is running (set by timber-root-sync in configResolved) */
  dev: boolean;
  /** CSS build manifest (populated by adapter after client build, null in dev) */
  buildManifest: BuildManifest | null;
  /** Startup timer for profiling cold start phases (active in dev, no-op in prod) */
  timer: StartupTimer;
}

function createPluginContext(config?: TimberUserConfig, root?: string): PluginContext {
  const projectRoot = root ?? process.cwd();
  const resolvedConfig: TimberUserConfig = { output: 'server', ...config };
  // Timer starts as active — swapped to noop in configResolved for production builds
  return {
    config: resolvedConfig,
    clientJavascript: resolveClientJavascript(resolvedConfig),
    routeTree: null,
    appDir: join(projectRoot, 'app'),
    root: projectRoot,
    dev: false,
    buildManifest: null,
    timer: createStartupTimer(),
  };
}

/**
 * Load timber.config.ts (or .js, .mjs) from the project root.
 * Returns the config object or null if no config file is found.
 */
async function loadTimberConfigFile(root: string): Promise<TimberUserConfig | null> {
  const configNames = ['timber.config.ts', 'timber.config.js', 'timber.config.mjs'];

  for (const name of configNames) {
    const configPath = join(root, name);
    if (existsSync(configPath)) {
      const mod = await import(pathToFileURL(configPath).href);
      return (mod.default ?? mod) as TimberUserConfig;
    }
  }
  return null;
}

/**
 * Merge file-based config into ctx.config. Inline config (already in ctx.config)
 * takes precedence — file config only fills in missing fields.
 */
function mergeFileConfig(ctx: PluginContext, fileConfig: TimberUserConfig): void {
  const inline = ctx.config;

  // For each top-level key, use inline value if present, otherwise file value
  ctx.config = {
    ...fileConfig,
    ...inline,
    // Deep merge for nested objects where both exist
    ...(fileConfig.limits && inline.limits
      ? { limits: { ...fileConfig.limits, ...inline.limits } }
      : {}),
    ...(fileConfig.dev && inline.dev ? { dev: { ...fileConfig.dev, ...inline.dev } } : {}),
    ...(fileConfig.mdx && inline.mdx ? { mdx: { ...fileConfig.mdx, ...inline.mdx } } : {}),
  };
}

function timberCache(_ctx: PluginContext): Plugin {
  return cacheTransformPlugin();
}

export function timber(config?: TimberUserConfig): PluginOption[] {
  const ctx = createPluginContext(config);
  // Sync ctx.root and ctx.appDir with Vite's resolved root, which may
  // differ from process.cwd() when --config points to a subdirectory.
  // Also loads timber.config.ts and merges it into ctx.config (inline config wins).
  const rootSync: Plugin = {
    name: 'timber-root-sync',
    async config(userConfig) {
      // Load timber.config.ts early — before configResolved/buildStart — so
      // all plugins (including timber-mdx) see the merged config in their
      // buildStart hooks. The config hook runs once and supports async.
      const root = userConfig.root ?? process.cwd();
      ctx.timer.start('config-load');
      const fileConfig = await loadTimberConfigFile(root);
      if (fileConfig) {
        mergeFileConfig(ctx, fileConfig);
        ctx.clientJavascript = resolveClientJavascript(ctx.config);
      }
      ctx.timer.end('config-load');
    },
    configResolved(resolved) {
      ctx.root = resolved.root;
      ctx.appDir = join(resolved.root, 'app');
      ctx.dev = resolved.command === 'serve';
      // In production builds, swap to a no-op timer to avoid overhead
      if (!ctx.dev) {
        ctx.timer = createNoopTimer();
      } else {
        // Start the overall dev server setup timer — ends in timber-dev-server
        ctx.timer.start('dev-server-setup');
      }
    },
  };
  // @vitejs/plugin-rsc handles:
  // - RSC/SSR/client environment setup
  // - "use client" directive → client reference proxy transformation
  // - "use server" directive → server reference transformation
  // - Client reference tracking and module map generation
  //
  // Loaded via dynamic import() because @vitejs/plugin-rsc is ESM-only.
  // Vite's config loader uses esbuild to transpile to CJS, which breaks
  // static imports of ESM-only packages. The dynamic import() is preserved
  // by esbuild and runs natively in ESM at runtime.
  //
  // serverHandler: false — timber has its own dev server (timber-dev-server)
  // entries — tells the RSC plugin about timber's virtual entry modules so
  //   it correctly wires up the browser entry (needed for React Fast Refresh
  //   preamble coordination with @vitejs/plugin-react)
  // customClientEntry: true — timber manages its own browser entry and
  //   preloading; skips RSC plugin's default "index" client entry convention
  //
  // The RSC plugin's built-in buildApp handles the 5-step multi-environment
  // build sequence (analyze references → build RSC → build client → build SSR).
  // We do NOT set customBuildApp — the RSC plugin's orchestration is correct
  // and handles bundle ordering, asset manifest generation, and environment
  // imports manifest. See @vitejs/plugin-rsc's buildApp implementation.
  ctx.timer.start('rsc-plugin-import');
  const rscPluginsPromise = import('@vitejs/plugin-rsc').then(({ default: vitePluginRsc }) => {
    ctx.timer.end('rsc-plugin-import');
    return vitePluginRsc({
      serverHandler: false,
      customClientEntry: true,
      entries: {
        rsc: 'virtual:timber-rsc-entry',
        ssr: 'virtual:timber-ssr-entry',
        client: 'virtual:timber-browser-entry',
      },
      clientChunks: assignClientChunk,
    });
  });

  return [
    rootSync,
    timberReactProd(),
    // @vitejs/plugin-react provides React Fast Refresh (state-preserving HMR)
    // for client components via Babel transform. Placed before @vitejs/plugin-rsc
    // following Vinext's convention — the RSC plugin's virtual browser entry
    // coordinates with plugin-react via __vite_plugin_react_preamble_installed__.
    react(),
    timberServerActionExports(),
    rscPluginsPromise,
    timberShims(ctx),
    timberRouting(ctx),
    timberEntries(ctx),
    timberBuildManifest(ctx),
    timberCache(ctx),
    timberStaticBuild(ctx),
    timberDynamicTransform(ctx),
    timberFonts(ctx),
    timberMdx(ctx),
    timberContent(ctx),
    timberServerBundle(), // Bundle all deps in server environments for prod
    timberChunks(),
    timberBuildReport(ctx), // Post-build: route table with bundle sizes
    timberAdapterBuild(ctx), // Post-build: invoke adapter.buildOutput()
    timberDevLogs(ctx), // Dev-only: forward server console.* to browser console
    timberDevServer(ctx), // Must be last — configureServer post-hook runs after all watchers
  ];
}

/**
 * Route map interface — augmented by the generated timber-routes.d.ts.
 *
 * Each key is a route path pattern. Values have:
 *   params: shape of URL params (e.g. { id: string })
 *   searchParams: parsed type from search-params.ts, or {} if none
 *
 * This interface is empty by default and populated via codegen.
 * See design/09-typescript.md §"Typed Routes".
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Routes {}

export default timber;
