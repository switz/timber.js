/**
 * RSC Fetch — handles fetching and parsing RSC Flight payloads.
 *
 * Extracted from router.ts to keep both files under the 500-line limit.
 * This module handles:
 * - Cache-busting URL generation for RSC requests
 * - Building RSC request headers (Accept, X-Timber-State-Tree)
 * - Extracting metadata from RSC response headers
 * - Fetching and decoding RSC payloads
 *
 * See design/19-client-navigation.md §"RSC Payload Handling"
 */

import type { SegmentInfo } from './segment-cache';
import type { HeadElement } from './head';
import type { RouterDeps } from './router';

// ─── Types ───────────────────────────────────────────────────────

/** Result of fetching an RSC payload — includes head elements and segment metadata. */
export interface FetchResult {
  payload: unknown;
  headElements: HeadElement[] | null;
  /** Segment metadata from X-Timber-Segments header for populating the segment cache. */
  segmentInfo: SegmentInfo[] | null;
  /** Route params from X-Timber-Params header for populating useParams(). */
  params: Record<string, string | string[]> | null;
  /** Segment paths that were skipped by the server (for client-side merging). */
  skippedSegments: string[] | null;
}

// ─── Constants ───────────────────────────────────────────────────

export const RSC_CONTENT_TYPE = 'text/x-component';

// ─── URL Helpers ─────────────────────────────────────────────────

/**
 * Generate a short random cache-busting ID (5 chars, a-z0-9).
 * Matches the format Next.js uses for _rsc params.
 */
function generateCacheBustId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 5; i++) {
    id += chars[(Math.random() * 36) | 0];
  }
  return id;
}

/**
 * Append a `_rsc=<id>` query parameter to the URL.
 * Follows Next.js's pattern — prevents CDN/browser from serving cached HTML
 * for RSC navigation requests and signals that this is an RSC fetch.
 */
function appendRscParam(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_rsc=${generateCacheBustId()}`;
}

export function buildRscHeaders(
  stateTree: { segments: string[] } | undefined,
  currentUrl?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: RSC_CONTENT_TYPE,
  };
  if (stateTree) {
    headers['X-Timber-State-Tree'] = JSON.stringify(stateTree);
  }
  // Send current URL for intercepting route resolution.
  // The server uses this to determine if an intercepting route should
  // render instead of the actual target route (modal pattern).
  // See design/07-routing.md §"Intercepting Routes"
  if (currentUrl) {
    headers['X-Timber-URL'] = currentUrl;
  }
  return headers;
}

// ─── Response Header Extraction ──────────────────────────────────

/**
 * Extract head elements from the X-Timber-Head response header.
 * Returns null if the header is missing or malformed.
 */
export function extractHeadElements(response: Response): HeadElement[] | null {
  const header = response.headers.get('X-Timber-Head');
  if (!header) return null;
  try {
    return JSON.parse(decodeURIComponent(header));
  } catch {
    return null;
  }
}

/**
 * Extract segment metadata from the X-Timber-Segments response header.
 * Returns null if the header is missing or malformed.
 *
 * Format: JSON array of {path, isAsync} objects describing the rendered
 * segment chain from root to leaf. Used to populate the client-side
 * segment cache for state tree diffing on subsequent navigations.
 */
export function extractSegmentInfo(response: Response): SegmentInfo[] | null {
  const header = response.headers.get('X-Timber-Segments');
  if (!header) return null;
  try {
    return JSON.parse(header);
  } catch {
    return null;
  }
}

/**
 * Extract skipped segment paths from the X-Timber-Skipped-Segments header.
 * Returns null if the header is missing or malformed.
 *
 * When the server skips sync layouts the client already has cached,
 * it sends this header listing the skipped segment paths (outermost first).
 * The client uses this to merge the partial payload with cached segments.
 */
export function extractSkippedSegments(response: Response): string[] | null {
  const header = response.headers.get('X-Timber-Skipped-Segments');
  if (!header) return null;
  try {
    const parsed = JSON.parse(header);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Extract route params from the X-Timber-Params response header.
 * Returns null if the header is missing or malformed.
 *
 * Used to populate useParams() after client-side navigation.
 */
export function extractParams(response: Response): Record<string, string | string[]> | null {
  const header = response.headers.get('X-Timber-Params');
  if (!header) return null;
  try {
    return JSON.parse(header);
  } catch {
    return null;
  }
}

// ─── Redirect Error ──────────────────────────────────────────────

/**
 * Thrown when an RSC payload response contains X-Timber-Redirect header.
 * Caught in navigate() to trigger a soft router navigation to the redirect target.
 */
export class RedirectError extends Error {
  readonly redirectUrl: string;
  constructor(url: string) {
    super(`Server redirect to ${url}`);
    this.redirectUrl = url;
  }
}

// ─── Fetch ───────────────────────────────────────────────────────

/**
 * Fetch an RSC payload from the server. If a decodeRsc function is provided,
 * the response is decoded into a React element tree via createFromFetch.
 * Otherwise, the raw response text is returned (test mode).
 *
 * Also extracts head elements from the X-Timber-Head response header
 * so the client can update document.title and <meta> tags after navigation.
 */
export async function fetchRscPayload(
  url: string,
  deps: RouterDeps,
  stateTree?: { segments: string[] },
  currentUrl?: string
): Promise<FetchResult> {
  const rscUrl = appendRscParam(url);
  const headers = buildRscHeaders(stateTree, currentUrl);
  if (deps.decodeRsc) {
    // Production path: use createFromFetch for streaming RSC decoding.
    // createFromFetch takes a Promise<Response> and progressively parses
    // the RSC Flight stream as chunks arrive.
    //
    // Intercept the response to read X-Timber-Head before createFromFetch
    // consumes the body. Reading headers does NOT consume the body stream.
    const fetchPromise = deps.fetch(rscUrl, { headers, redirect: 'manual' });
    let headElements: HeadElement[] | null = null;
    let segmentInfo: SegmentInfo[] | null = null;
    let params: Record<string, string | string[]> | null = null;
    let skippedSegments: string[] | null = null;
    const wrappedPromise = fetchPromise.then((response) => {
      // Detect server-side redirects. The server returns 204 + X-Timber-Redirect
      // for RSC payload requests instead of a raw 302, because fetch with
      // redirect: "manual" turns 302s into opaque redirects (status 0, null body)
      // which crashes createFromFetch when it tries to read the body stream.
      const redirectLocation =
        response.headers.get('X-Timber-Redirect') ||
        (response.status >= 300 && response.status < 400 ? response.headers.get('Location') : null);
      if (redirectLocation) {
        throw new RedirectError(redirectLocation);
      }
      headElements = extractHeadElements(response);
      segmentInfo = extractSegmentInfo(response);
      params = extractParams(response);
      skippedSegments = extractSkippedSegments(response);
      return response;
    });
    // Await so headElements/segmentInfo/params are populated before we return.
    // Also await the decoded payload — createFromFetch returns a thenable
    // that resolves to the React element tree.
    await wrappedPromise;
    const payload = await deps.decodeRsc(wrappedPromise);
    return { payload, headElements, segmentInfo, params, skippedSegments };
  }
  // Test/fallback path: return raw text
  const response = await deps.fetch(rscUrl, { headers, redirect: 'manual' });
  // Check for redirect in test path too
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('Location');
    if (location) {
      throw new RedirectError(location);
    }
  }
  return {
    payload: await response.text(),
    headElements: extractHeadElements(response),
    segmentInfo: extractSegmentInfo(response),
    params: extractParams(response),
    skippedSegments: extractSkippedSegments(response),
  };
}
