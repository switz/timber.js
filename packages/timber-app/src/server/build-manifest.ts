/**
 * Build manifest types and utilities for CSS and JS asset tracking.
 *
 * The build manifest maps route segment file paths to their output
 * chunks from Vite's client build. This enables:
 * - <link rel="stylesheet"> injection in HTML <head>
 * - <script type="module"> with hashed URLs in production
 * - <link rel="modulepreload"> for client chunk dependencies
 * - Link preload headers for Early Hints (103)
 *
 * In dev mode, Vite's HMR client handles CSS/JS injection, so the build
 * manifest is empty. In production, it's populated from Vite's
 * .vite/manifest.json after the client build.
 *
 * Design docs: 18-build-system.md §"Build Manifest", 02-rendering-pipeline.md §"Early Hints"
 */

/** Build manifest mapping input file paths to output asset URLs. */
export interface BuildManifest {
  /** Map from input file path (relative to project root) to output CSS URLs. */
  css: Record<string, string[]>;
  /** Map from input file path to output JS chunk URL (hashed filename). */
  js: Record<string, string>;
  /** Map from input file path to transitive JS dependency URLs for modulepreload. */
  modulepreload: Record<string, string[]>;
}

/** Empty build manifest used in dev mode. */
export const EMPTY_BUILD_MANIFEST: BuildManifest = { css: {}, js: {}, modulepreload: {} };

/** Segment shape expected by collectRouteCss (matches ManifestSegmentNode). */
interface SegmentWithFiles {
  layout?: { filePath: string };
  page?: { filePath: string };
}

/**
 * Collect all CSS files needed for a matched route's segment chain.
 *
 * Walks segments root → leaf, collecting CSS for each layout and page.
 * Deduplicates while preserving order (root layout CSS first).
 */
export function collectRouteCss(
  segments: SegmentWithFiles[],
  manifest: BuildManifest
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const segment of segments) {
    for (const file of [segment.layout, segment.page]) {
      if (!file) continue;
      const cssFiles = manifest.css[file.filePath];
      if (!cssFiles) continue;
      for (const url of cssFiles) {
        if (!seen.has(url)) {
          seen.add(url);
          result.push(url);
        }
      }
    }
  }

  return result;
}

/**
 * Generate <link rel="stylesheet"> tags for CSS URLs.
 *
 * Returns an HTML string to prepend to headHtml for injection
 * via injectHead() before </head>.
 */
export function buildCssLinkTags(cssUrls: string[]): string {
  return cssUrls
    .map((url) => `<link rel="stylesheet" href="${url}">`)
    .join('');
}

/**
 * Generate a Link header value for CSS preload hints.
 *
 * Cloudflare CDN automatically converts Link headers with rel=preload
 * into 103 Early Hints responses. This avoids platform-specific 103
 * sending code.
 *
 * Example output: `</assets/root.css>; rel=preload; as=style, </assets/page.css>; rel=preload; as=style`
 */
export function buildLinkHeaders(cssUrls: string[]): string {
  return cssUrls
    .map((url) => `<${url}>; rel=preload; as=style`)
    .join(', ');
}

// ─── JS chunk utilities ──────────────────────────────────────────────────

/**
 * Collect JS chunk URLs for a matched route's segment chain.
 *
 * Walks segments root → leaf, collecting the JS chunk for each layout
 * and page. Deduplicates while preserving order.
 */
export function collectRouteJs(segments: SegmentWithFiles[], manifest: BuildManifest): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const segment of segments) {
    for (const file of [segment.layout, segment.page]) {
      if (!file) continue;
      const jsUrl = manifest.js[file.filePath];
      if (!jsUrl) continue;
      if (!seen.has(jsUrl)) {
        seen.add(jsUrl);
        result.push(jsUrl);
      }
    }
  }

  return result;
}

/**
 * Collect modulepreload URLs for a matched route's segment chain.
 *
 * Walks segments root → leaf, collecting transitive JS dependencies
 * for each layout and page. Deduplicates across segments.
 */
export function collectRouteModulepreloads(
  segments: SegmentWithFiles[],
  manifest: BuildManifest
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const segment of segments) {
    for (const file of [segment.layout, segment.page]) {
      if (!file) continue;
      const preloads = manifest.modulepreload[file.filePath];
      if (!preloads) continue;
      for (const url of preloads) {
        if (!seen.has(url)) {
          seen.add(url);
          result.push(url);
        }
      }
    }
  }

  return result;
}

/**
 * Generate <link rel="modulepreload"> tags for JS dependency URLs.
 *
 * Modulepreload hints tell the browser to fetch and parse JS modules
 * before they're needed, reducing waterfall latency for dynamic imports.
 */
export function buildModulepreloadTags(urls: string[]): string {
  return urls.map((url) => `<link rel="modulepreload" href="${url}">`).join('');
}

/**
 * Generate a <script type="module"> tag for a JS entry point.
 */
export function buildEntryScriptTag(url: string): string {
  return `<script type="module" src="${url}"></script>`;
}
