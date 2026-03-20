#!/usr/bin/env node

// timber.js CLI
//
// Wraps Vite commands with timber-specific behavior.
// See design/18-build-system.md §"CLI".
//
// Commands:
//   timber dev      — Start Vite dev server with HMR
//   timber build    — Run multi-environment build via createBuilder/buildApp
//   timber preview  — Serve the production build
//   timber check    — Validate types + routes without building

const COMMANDS = ['dev', 'build', 'preview', 'check'] as const;
type Command = (typeof COMMANDS)[number];

export interface ParsedArgs {
  command: Command;
  config: string | undefined;
}

export interface CommandOptions {
  config?: string;
}

/**
 * Parse CLI arguments into a structured command + options.
 * Accepts: timber <command> [--config|-c <path>]
 */
export function parseArgs(args: string[]): ParsedArgs {
  if (args.length === 0) {
    throw new Error(
      'No command provided. Usage: timber <dev|build|preview|check> [--config <path>]'
    );
  }

  const command = args[0];
  if (!COMMANDS.includes(command as Command)) {
    throw new Error(`Unknown command: ${command}. Available commands: ${COMMANDS.join(', ')}`);
  }

  let config: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--config' || args[i] === '-c') {
      config = args[++i];
      if (!config) {
        throw new Error('--config requires a path argument');
      }
    }
  }

  return { command: command as Command, config };
}

// ─── Command Implementations ─────────────────────────────────────────────────

/** @internal Dependency injection for testing. */
export interface ViteDeps {
  createServer?: typeof import('vite').createServer;
  createBuilder?: typeof import('vite').createBuilder;
  preview?: typeof import('vite').preview;
}

/**
 * Start the Vite dev server.
 * Middleware re-runs on file change via HMR wiring in timber-routing.
 */
export async function runDev(options: CommandOptions, _deps?: ViteDeps): Promise<void> {
  const { createServer } = _deps ?? (await import('vite'));
  const server = await createServer({
    configFile: options.config,
  });
  await server.listen();
  server.printUrls();
}

/**
 * Run the production build using createBuilder + buildApp.
 * Direct build() calls do NOT trigger the RSC plugin's multi-environment
 * pipeline — createBuilder/buildApp is required.
 */
export async function runBuild(options: CommandOptions, _deps?: ViteDeps): Promise<void> {
  const { createBuilder } = _deps ?? (await import('vite'));
  const builder = await createBuilder({
    configFile: options.config,
  });
  await builder.buildApp();
}

/**
 * Determine whether to use the adapter's preview or Vite's built-in preview.
 * Exported for testing — the actual runPreview function uses this internally.
 */
export function resolvePreviewStrategy(
  adapter: import('./adapters/types').TimberPlatformAdapter | undefined
): 'adapter' | 'vite' {
  if (adapter && typeof adapter.preview === 'function') {
    return 'adapter';
  }
  return 'vite';
}

/**
 * Load timber.config.ts from the project root.
 * Returns the config object with adapter, output, etc.
 * Returns null if no config file is found.
 */
async function loadTimberConfig(
  root: string
): Promise<{ adapter?: import('./adapters/types').TimberPlatformAdapter; output?: string } | null> {
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');

  const configNames = ['timber.config.ts', 'timber.config.js', 'timber.config.mjs'];

  for (const name of configNames) {
    const configPath = join(root, name);
    if (existsSync(configPath)) {
      // Use Vite's built-in config loading to handle TypeScript
      const mod = await import(pathToFileURL(configPath).href);
      return mod.default ?? mod;
    }
  }
  return null;
}

/**
 * Serve the production build for local testing.
 * If the adapter provides a preview() method, it takes priority.
 * Otherwise falls back to Vite's built-in preview server.
 */
export async function runPreview(options: CommandOptions, _deps?: ViteDeps): Promise<void> {
  const { join } = await import('node:path');

  // Try to load timber config for adapter-specific preview
  const root = process.cwd();
  const config = await loadTimberConfig(root).catch(() => null);
  const adapter = config?.adapter as import('./adapters/types').TimberPlatformAdapter | undefined;

  if (resolvePreviewStrategy(adapter) === 'adapter') {
    const buildDir = join(root, 'dist');
    const timberConfig = { output: (config?.output ?? 'server') as 'server' | 'static' };
    await adapter!.preview!(timberConfig, buildDir);
    return;
  }

  // Fallback: Vite's built-in preview server
  const { preview } = _deps ?? (await import('vite'));
  const server = await preview({
    configFile: options.config,
  });
  server.printUrls();
}

/**
 * Validate types and routes without producing build output.
 * Runs tsgo --noEmit for type checking.
 */
export async function runCheck(options: CommandOptions): Promise<void> {
  const { execFile } = await import('node:child_process');

  await new Promise<void>((resolve, reject) => {
    const configArgs = options.config ? ['--project', options.config] : [];
    execFile('tsgo', ['--noEmit', ...configArgs], (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (err) {
        reject(new Error(`Type check failed with exit code ${err.code}`));
      } else {
        resolve();
      }
    });
  });
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const options: CommandOptions = { config: parsed.config };

  switch (parsed.command) {
    case 'dev':
      await runDev(options);
      break;
    case 'build':
      await runBuild(options);
      break;
    case 'preview':
      await runPreview(options);
      break;
    case 'check':
      await runCheck(options);
      break;
  }
}

// Run main when executed as a CLI (not imported in tests).
// The bin shim (bin/timber.mjs) does `import '../dist/cli.js'`, so
// process.argv[1] points to the shim, not this file. We check both:
// direct execution AND being imported by the timber bin shim.
const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1]) ||
    process.argv[1].endsWith('bin/timber.mjs') ||
    process.argv[1].endsWith('bin/timber'));

if (isDirectExecution) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
