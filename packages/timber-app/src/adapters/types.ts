// Platform adapter interface
//
// Adapters transform build output into deployable artifacts and provide
// runtime hooks for platform-specific capabilities (waitUntil, etc.).
// See design/11-platform.md §"The Adapter Interface".

/**
 * Configuration passed to adapter lifecycle methods.
 * A subset of the resolved timber.config.ts relevant to adapters.
 */
export interface TimberConfig {
  output: 'server' | 'static';
  clientJavascriptDisabled?: boolean;
  /**
   * JS module source that sets globalThis.__TIMBER_BUILD_MANIFEST__.
   * Written by adapters as _timber-manifest-init.js, imported before the RSC handler.
   * Undefined when no build manifest was produced (e.g., dev mode or no client assets).
   */
  manifestInit?: string;
}

/**
 * The formal adapter interface. An adapter transforms the build output
 * into a deployable artifact for a specific platform.
 *
 * Adapters are small: they receive the build output directory and
 * transform or copy it into whatever shape the platform expects.
 */
export interface TimberPlatformAdapter {
  /** Unique adapter name (e.g. 'cloudflare', 'node', 'bun'). */
  name: string;

  /**
   * Transform the build output for the target platform.
   * Called at the end of `timber build`.
   */
  buildOutput(config: TimberConfig, buildDir: string): Promise<void>;

  /**
   * Start a local preview server for the built output.
   * Falls back to the built-in Node.js preview server if not provided.
   */
  preview?(config: TimberConfig, buildDir: string): Promise<void>;

  /**
   * Register a promise to be kept alive after the response is sent.
   * Maps to platform-specific lifecycle extension (e.g. ctx.waitUntil()
   * on Cloudflare Workers). Undefined if the platform doesn't support it.
   */
  waitUntil?(promise: Promise<unknown>): void;

  /**
   * Send 103 Early Hints to the client before the final response.
   *
   * On Node.js (v18.11+) and Bun, uses `res.writeEarlyHints()` on the
   * raw HTTP response. On Cloudflare, the CDN converts Link headers into
   * 103 automatically — this method is not needed.
   *
   * Undefined if the platform doesn't support application-level 103,
   * or if 103 is handled at the CDN level (Cloudflare).
   */
  sendEarlyHints?(links: string[]): void;
}
