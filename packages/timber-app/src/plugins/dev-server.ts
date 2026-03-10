/**
 * timber-dev-server — Vite sub-plugin for dev server request handling.
 *
 * Registers a configureServer middleware that intercepts requests and
 * routes them through the timber pipeline:
 *   proxy.ts → canonicalize → route match → middleware → access → render → flush
 *
 * The RSC entry module is loaded via Vite's ssrLoadModule, which uses
 * Vite's dev module graph instead of built bundles. The full pipeline
 * (including proxy.ts) runs on every request.
 *
 * Design docs: 18-build-system.md §"Dev Server", 02-rendering-pipeline.md
 */

import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { PluginContext } from '../index.js';
import { setViteServer } from '../server/dev-warnings.js';
import { sendErrorToOverlay, classifyErrorPhase } from './dev-error-overlay.js';

// ─── Constants ────────────────────────────────────────────────────────────

const RSC_ENTRY_ID = 'virtual:timber-rsc-entry';

/**
 * Config file names that trigger a full dev server restart when changed.
 * See 21-dev-server.md §HMR Wiring — config is loaded once at startup.
 */
const CONFIG_FILE_NAMES = ['timber.config.ts', 'timber.config.js', 'timber.config.mjs'];

/**
 * URL prefixes that are Vite-internal and should never be intercepted.
 * These are passed through to Vite's built-in middleware.
 */
const VITE_INTERNAL_PREFIXES = [
  '/@', // /@vite/client, /@fs/, /@id/
  '/__vite', // /__vite_hmr, /__vite_ping
  '/node_modules/',
];

/**
 * File extensions that indicate static asset requests.
 * These are passed through to Vite's static file serving.
 */
const ASSET_EXTENSIONS =
  /\.(?:js|ts|tsx|jsx|css|map|json|svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|eot|mp4|webm|ogg|mp3|wav)(?:\?.*)?$/;

// ─── Plugin ───────────────────────────────────────────────────────────────

/**
 * Create the timber-dev-server Vite plugin.
 *
 * Hook: configureServer (returns post-hook to register after Vite's middleware)
 */
export function timberDevServer(ctx: PluginContext): Plugin {
  return {
    name: 'timber-dev-server',

    // Only active in dev mode (command === 'serve'), not during build.
    // See 21-dev-server.md §Plugin Registration.
    apply: 'serve',

    /**
     * Register the dev server middleware and config file watcher.
     *
     * Returns a post-hook function so our middleware runs after Vite's
     * built-in middleware (static files, HMR, transforms). This means
     * asset requests are already handled by Vite before reaching us.
     */
    configureServer(server: ViteDevServer) {
      // Watch config files for full restart.
      // timber.config.ts is loaded once at startup — any change requires
      // a full dev server restart. See 21-dev-server.md §HMR Wiring.
      const configPaths = CONFIG_FILE_NAMES.map((name) => join(ctx.root, name));

      server.watcher.on('change', (filePath: string) => {
        if (configPaths.includes(filePath)) {
          server.restart();
        }
      });

      // Register Vite server for browser console warning forwarding.
      // See 21-dev-server.md §Dev-Mode Warnings.
      setViteServer(server);

      // Return post-hook — registers middleware after Vite's internals
      return () => {
        server.middlewares.use(createTimberMiddleware(server, ctx.root));
      };
    },
  };
}

// ─── Middleware ────────────────────────────────────────────────────────────

/**
 * Create the Connect middleware that routes requests through the timber pipeline.
 *
 * For route requests (HTML pages, API endpoints), the middleware:
 * 1. Loads the RSC entry via ssrLoadModule
 * 2. Converts the Node request to a Web Request
 * 3. Passes it through the RSC handler (which runs the full pipeline)
 * 4. Converts the Web Response back to a Node response
 *
 * For non-route requests (assets, Vite internals, HMR), the middleware
 * calls next() to let Vite handle them.
 */
function createTimberMiddleware(server: ViteDevServer, projectRoot: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = req.url;
    if (!url) {
      next();
      return;
    }

    // Pass through Vite-internal requests
    if (isViteInternal(url)) {
      next();
      return;
    }

    // Pass through static asset requests
    if (isAssetRequest(url)) {
      next();
      return;
    }

    // Step 1: Load the RSC entry module.
    // Separated from the handler call to distinguish module transform errors
    // (syntax errors, import resolution) from pipeline errors.
    let handler: (req: Request) => Promise<Response>;
    try {
      const rscModule = await server.ssrLoadModule(RSC_ENTRY_ID);
      handler = rscModule.default as (req: Request) => Promise<Response>;
    } catch (error) {
      // Module transform error — syntax error, missing import, etc.
      // Vite may already show its own overlay for these, but we still
      // log to stderr with frame dimming for the terminal.
      if (error instanceof Error) {
        sendErrorToOverlay(server, error, 'module-transform', projectRoot);
      }
      respond500(res, error);
      return;
    }

    if (typeof handler !== 'function') {
      console.error('[timber] RSC entry module does not export a default function');
      next();
      return;
    }

    // Step 2: Run the pipeline.
    try {
      // Convert Node IncomingMessage → Web Request
      const webRequest = toWebRequest(req);

      // Run the full pipeline
      const webResponse = await handler(webRequest);

      // If the pipeline returned 404, pass through to Vite's fallback
      // This allows Vite to serve index.html for SPA fallback or show its 404 page
      if (webResponse.status === 404) {
        next();
        return;
      }

      // Convert Web Response → Node ServerResponse
      await sendWebResponse(res, webResponse);
    } catch (error) {
      // Pipeline error — classify the phase, send to overlay, respond 500.
      // The dev server remains running for recovery on file fix + HMR.
      if (error instanceof Error) {
        const phase = classifyErrorPhase(error, projectRoot);
        sendErrorToOverlay(server, error, phase, projectRoot);
      } else {
        process.stderr.write(`\x1b[31m[timber] Dev server error:\x1b[0m ${String(error)}\n`);
      }
      respond500(res, error);
    }
  };
}

/**
 * Send a 500 response without crashing the dev server.
 */
function respond500(res: ServerResponse, error: unknown): void {
  if (!res.headersSent) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain');
    res.end(
      `[timber] Internal server error\n\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    );
  }
}

// ─── Request/Response Conversion ──────────────────────────────────────────

/**
 * Convert a Node IncomingMessage to a Web Request.
 *
 * Constructs the full URL from the Host header and request URL,
 * and forwards the method, headers, and body.
 */
function toWebRequest(nodeReq: IncomingMessage): Request {
  const protocol = 'http';
  const host = nodeReq.headers.host ?? 'localhost';
  const url = `${protocol}://${host}${nodeReq.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        headers.append(key, v);
      }
    } else {
      headers.set(key, value);
    }
  }

  const method = nodeReq.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';

  return new Request(url, {
    method,
    headers,
    body: hasBody ? nodeReadableToWebStream(nodeReq) : undefined,
    // @ts-expect-error — duplex is required for streaming request bodies
    duplex: hasBody ? 'half' : undefined,
  });
}

/**
 * Convert a Node Readable stream to a Web ReadableStream.
 */
function nodeReadableToWebStream(nodeStream: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on('end', () => {
        controller.close();
      });
      nodeStream.on('error', (err) => {
        controller.error(err);
      });
    },
  });
}

/**
 * Write a Web Response to a Node ServerResponse.
 *
 * Copies status code, headers, and streams the body.
 */
async function sendWebResponse(nodeRes: ServerResponse, webResponse: Response): Promise<void> {
  nodeRes.statusCode = webResponse.status;

  // Copy headers
  webResponse.headers.forEach((value, key) => {
    nodeRes.setHeader(key, value);
  });

  // Stream the body
  if (!webResponse.body) {
    nodeRes.end();
    return;
  }

  const reader = webResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      nodeRes.write(value);
    }
  } finally {
    reader.releaseLock();
    nodeRes.end();
  }
}

// ─── URL Classification ──────────────────────────────────────────────────

/**
 * Check if a URL is a Vite-internal request that should be passed through.
 */
function isViteInternal(url: string): boolean {
  return VITE_INTERNAL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Check if a URL looks like a static asset request.
 */
function isAssetRequest(url: string): boolean {
  return ASSET_EXTENSIONS.test(url);
}
