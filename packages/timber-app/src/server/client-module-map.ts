/**
 * Client module map — maps client reference IDs to their SSR module loaders.
 *
 * When the RSC stream contains a client component reference (from a
 * "use client" module), the SSR environment needs to resolve it to the
 * actual component module so it can render the component to HTML.
 *
 * The @vitejs/plugin-rsc SSR runtime handles this internally via its
 * setRequireModule hook — it imports client reference modules from the
 * SSR environment's module graph. This module provides the configuration
 * bridge between timber's entry system and the RSC plugin's runtime.
 *
 * Design docs: 18-build-system.md §"Entry Files", 02-rendering-pipeline.md
 */

/**
 * Client reference metadata used during SSR to resolve client components.
 *
 * The RSC plugin tracks these internally via `clientReferenceMetaMap`.
 * At SSR time, when `createFromReadableStream` encounters a client
 * reference in the RSC payload, it uses the module map to import the
 * actual component for server-side HTML rendering.
 */
export interface ClientModuleEntry {
  /** The module ID (Vite-resolved file path) */
  id: string;
  /** The export name (e.g., 'default', 'Counter') */
  name: string;
  /** Async module loader */
  load: () => Promise<Record<string, unknown>>;
}

/**
 * Create a client module map for SSR resolution.
 *
 * In dev mode, the RSC plugin's SSR runtime (`@vitejs/plugin-rsc/ssr`)
 * handles client reference resolution automatically via its initialize()
 * function which sets up `setRequireModule` with dynamic imports through
 * Vite's dev server. No explicit module map is needed.
 *
 * In production builds, the RSC plugin generates a `virtual:vite-rsc/client-references`
 * module that maps client reference IDs to their chunk imports. The SSR
 * runtime reads this at startup.
 *
 * This function returns an empty map as a placeholder — the actual
 * resolution is handled by the RSC plugin's runtime internals.
 */
export function createClientModuleMap(): Record<string, ClientModuleEntry> {
  // The @vitejs/plugin-rsc SSR runtime handles client reference
  // resolution internally. In dev mode, it uses Vite's module runner
  // to dynamically import client modules. In production, it reads
  // from the virtual:vite-rsc/client-references manifest.
  //
  // This empty map serves as the timber-side type contract. Framework
  // code that needs to interact with client references at a higher
  // level (e.g., collecting CSS deps, prefetch hints) can extend this.
  return {};
}
