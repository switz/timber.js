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
import { isRunnableDevEnvironment } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { PluginContext } from '../index.js';
import { setViteServer } from '../server/dev-warnings.js';
import { sendErrorToOverlay, classifyErrorPhase, parseFirstAppFrame } from './dev-error-overlay.js';

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
     * Registers as a pre-hook (no return value) so our middleware runs
     * before Vite's built-in SPA fallback / historyApiFallback. This
     * ensures we see the original URL (e.g. /blog) rather than a
     * rewritten /index.html. Vite-internal and asset requests are
     * filtered out explicitly and passed through to Vite.
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

      // Listen for client-side errors forwarded from the browser.
      // The browser entry sends 'timber:client-error' events via HMR
      // for uncaught errors and unhandled rejections. We echo them back
      // as Vite's '{ type: "error" }' payload to trigger the overlay.
      listenForClientErrors(server, ctx.root);

      // Pre-hook — registers middleware before Vite's internals
      server.middlewares.use(createTimberMiddleware(server, ctx.root));

      // Log startup timing summary. configureServer runs on all plugins
      // before the server listens, so this captures the full cold start.
      ctx.timer.end('dev-server-setup');
      const summary = ctx.timer.formatSummary();
      if (summary) {
        console.log(summary);
      }
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

    // Step 1: Load the RSC entry module from the RSC environment.
    // The RSC entry runs in the 'rsc' Vite environment (separate module
    // graph with react-server conditions). In dev mode, this uses the
    // environment's module runner for HMR-aware loading.
    let handler: (req: Request) => Promise<Response>;
    try {
      const rscEnv = server.environments.rsc;
      if (!isRunnableDevEnvironment(rscEnv)) {
        throw new Error('[timber] RSC environment is not runnable');
      }
      const rscModule = await rscEnv.runner.import(RSC_ENTRY_ID);
      handler = rscModule.default as (req: Request) => Promise<Response>;

      // Wire pipeline errors into the browser error overlay.
      // setDevPipelineErrorHandler is only defined in dev (rsc-entry.ts exports it).
      const setHandler = rscModule.setDevPipelineErrorHandler as
        | ((fn: (error: Error, phase: string) => void) => void)
        | undefined;
      if (typeof setHandler === 'function') {
        setHandler((error) => {
          sendErrorToOverlay(server, error, classifyErrorPhase(error, projectRoot), projectRoot);
        });
      }
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

  // Flush headers immediately so the client can start processing
  // the response (critical for SSE and other streaming responses).
  nodeRes.flushHeaders();

  const reader = webResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // write() returns false when the kernel buffer is full, but we
      // don't need back-pressure here — just keep pushing chunks.
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

// ─── Client Error Listener ─────────────────────────────────────────────

interface ClientErrorPayload {
  message: string;
  stack: string;
  componentStack: string | null;
}

/**
 * Listen for client-side errors forwarded from the browser via HMR.
 *
 * The browser entry catches uncaught errors and unhandled rejections,
 * then sends them as 'timber:client-error' custom events. We parse
 * the first app frame for the overlay's loc field and forward the
 * error to Vite's overlay protocol.
 */
function listenForClientErrors(server: ViteDevServer, projectRoot: string): void {
  server.hot.on('timber:client-error', (data: ClientErrorPayload) => {
    const loc = parseFirstAppFrame(data.stack, projectRoot);

    let message = data.message;
    if (data.componentStack) {
      message = `${data.message}\n\nComponent Stack:\n${data.componentStack.trim()}`;
    }

    // Log to stderr
    const RED = '\x1b[31m';
    const BOLD = '\x1b[1m';
    const RESET = '\x1b[0m';
    process.stderr.write(
      `${RED}${BOLD}[timber] Client Error${RESET}\n${RED}${data.message}${RESET}\n\n`
    );

    // Forward to Vite's overlay
    try {
      server.hot.send({
        type: 'error',
        err: {
          message,
          stack: data.stack,
          id: loc?.file,
          plugin: 'timber (Client)',
          loc: loc ? { file: loc.file, line: loc.line, column: loc.column } : undefined,
        },
      });
    } catch {
      // Overlay send must never crash the dev server
    }
  });
}
