/**
 * Fallback error rendering — handles catastrophic errors that escape the
 * render pipeline entirely (e.g. module evaluation failures).
 *
 * In dev mode: renders a styled HTML page with error details and stack trace.
 * The Vite client script is included so the error overlay still fires.
 *
 * In production: attempts to render root error pages (500.tsx / 5xx.tsx /
 * error.tsx) via the normal RSC → SSR pipeline. Stack traces are never
 * exposed to the client (design/13-security.md principle 4).
 */

import type { RouteMatch } from '#/server/pipeline.js';
import type { ManifestSegmentNode } from '#/server/route-matcher.js';
import type { ClientBootstrapConfig } from '#/server/html-injectors.js';
import type { LayoutEntry } from '#/server/deny-renderer.js';

/**
 * Render a fallback error page when the render pipeline throws.
 *
 * In dev: styled HTML with error details.
 * In prod: renders root error pages via renderErrorPage.
 */
export async function renderFallbackError(
  error: unknown,
  req: Request,
  responseHeaders: Headers,
  isDev: boolean,
  rootSegment: ManifestSegmentNode,
  clientBootstrap: ClientBootstrapConfig
): Promise<Response> {
  if (isDev) {
    return renderDevErrorPage(error);
  }
  // Lazy import to avoid loading error-renderer in the pipeline module
  const { renderErrorPage } = await import('#/server/rsc-entry/error-renderer.js');
  const segments = [rootSegment];
  const layoutComponents: LayoutEntry[] = [];
  if (rootSegment.layout) {
    const mod = (await rootSegment.layout.load()) as Record<string, unknown>;
    if (mod.default) {
      layoutComponents.push({
        component: mod.default as (...args: unknown[]) => unknown,
        segment: rootSegment,
      });
    }
  }
  const match: RouteMatch = { segments: segments as never, params: {} };
  return renderErrorPage(
    error,
    500,
    segments,
    layoutComponents,
    req,
    match,
    responseHeaders,
    clientBootstrap
  );
}

/**
 * Render a dev-mode 500 error page with error message and stack trace.
 *
 * Returns an HTML Response that displays the error in a styled page.
 * The Vite HMR client script is included so the error overlay still fires.
 */
export function renderDevErrorPage(error: unknown): Response {
  const err = error instanceof Error ? error : new Error(String(error));
  const title = err.name || 'Error';
  const message = escapeHtml(err.message);
  const stack = err.stack ? escapeHtml(err.stack) : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>500 — ${escapeHtml(title)}</title>
  <script type="module" src="/@vite/client"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 2rem;
      line-height: 1.6;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .badge {
      display: inline-block;
      background: #e74c3c;
      color: white;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.2rem 0.6rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      color: #ff6b6b;
      margin-bottom: 0.5rem;
      word-break: break-word;
    }
    .message {
      font-size: 1.1rem;
      color: #ccc;
      margin-bottom: 1.5rem;
      word-break: break-word;
    }
    .stack-container {
      background: #16213e;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 1rem;
      overflow-x: auto;
    }
    .stack {
      font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace;
      font-size: 0.8rem;
      color: #a0a0c0;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .hint {
      margin-top: 1.5rem;
      font-size: 0.85rem;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <span class="badge">500 Internal Server Error</span>
    <h1>${escapeHtml(title)}</h1>
    <p class="message">${message}</p>
    ${stack ? `<div class="stack-container"><pre class="stack">${stack}</pre></div>` : ''}
    <p class="hint">This error page is only shown in development.</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
