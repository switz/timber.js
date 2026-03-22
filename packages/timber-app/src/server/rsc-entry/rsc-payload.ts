/**
 * RSC Payload Response — Handles client-side navigation requests.
 *
 * For requests with `Accept: text/x-component`, the RSC Flight stream is
 * returned directly without SSR HTML rendering. The client decodes it via
 * `createFromFetch` and renders into the hydrated React root.
 *
 * Design docs: 19-client-navigation.md §"RSC Payload Handling",
 *              16-metadata.md §"Head Elements"
 */

import type { LayoutEntry } from '#/server/deny-renderer.js';
import { renderDenyPageAsRsc } from '#/server/deny-renderer.js';
import type { RouteMatch } from '#/server/pipeline.js';
import type { RedirectSignal } from '#/server/primitives.js';
import type { HeadElement, LayoutComponentEntry } from '#/server/route-element-builder.js';
import type { ManifestSegmentNode } from '#/server/route-matcher.js';

import {
  buildRedirectResponse,
  buildSegmentInfo,
  createDebugChannelSink,
  RSC_CONTENT_TYPE,
} from './helpers.js';
import type { RenderSignals } from './rsc-stream.js';

/**
 * Build an RSC payload Response for a client-side navigation request.
 *
 * Reads the first chunk from the RSC stream before committing headers.
 * Async components throw during stream consumption, not during
 * renderToReadableStream. Reading one chunk triggers rendering of the
 * initial component tree, allowing onError to capture DenySignal/
 * RedirectSignal before we commit the response. See TIM-344.
 */
export async function buildRscPayloadResponse(
  req: Request,
  rscStream: ReadableStream<Uint8Array>,
  signals: RenderSignals,
  segments: ManifestSegmentNode[],
  layoutComponents: LayoutComponentEntry[],
  headElements: HeadElement[],
  match: RouteMatch,
  responseHeaders: Headers,
  skippedSegments?: string[]
): Promise<Response> {
  // Read the first chunk from the RSC stream before committing headers.
  const reader = rscStream.getReader();
  const firstRead = await reader.read();

  // Yield to the microtask queue so that async component rejections
  // (e.g. an async-wrapped page component that throws redirect())
  // propagate to the onError callback before we check the signals.
  // The rejected Promise from an async component resolves in the next
  // microtask after read(), so we need at least one tick.
  await new Promise<void>((r) => setTimeout(r, 0));

  // Check for redirect/deny signals detected during initial rendering
  const trackedRedirect = signals.redirectSignal as RedirectSignal | null;
  if (trackedRedirect) {
    reader.cancel();
    return buildRedirectResponse(req, trackedRedirect, responseHeaders);
  }
  if (signals.denySignal) {
    reader.cancel();
    return renderDenyPageAsRsc(
      signals.denySignal,
      segments,
      layoutComponents as LayoutEntry[],
      responseHeaders,
      createDebugChannelSink
    );
  }

  // Reconstruct the stream: prepend the buffered first chunk,
  // then continue piping from the original reader.
  const patchedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (firstRead.value) controller.enqueue(firstRead.value);
      if (firstRead.done) {
        controller.close();
        return;
      }
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel();
    },
  });

  responseHeaders.set('content-type', `${RSC_CONTENT_TYPE}; charset=utf-8`);
  // Vary on Accept so CDNs cache HTML and RSC responses separately
  // for the same URL. The client appends ?_rsc=<id> as a cache-bust,
  // but Vary ensures correct behavior even without the query param.
  responseHeaders.set('Vary', 'Accept');

  // Send resolved head elements so the client can update document.title
  // and <meta> tags after SPA navigation. See design/16-metadata.md.
  const encoded = encodeURIComponent(JSON.stringify(headElements));
  if (encoded.length <= 4096) {
    responseHeaders.set('X-Timber-Head', encoded);
  }

  // Send segment metadata so the client can populate its segment cache
  // for state tree diffing on subsequent navigations.
  // See design/19-client-navigation.md §"X-Timber-State-Tree Header"
  const segmentInfo = buildSegmentInfo(segments, layoutComponents);
  responseHeaders.set('X-Timber-Segments', JSON.stringify(segmentInfo));

  // Send skipped segments so the client can merge the partial RSC payload
  // with its cached segment elements. See design/19-client-navigation.md.
  if (skippedSegments && skippedSegments.length > 0) {
    responseHeaders.set('X-Timber-Skipped-Segments', JSON.stringify(skippedSegments));
  }

  // Send route params so the client can populate useParams() after
  // SPA navigation. Without this, useParams() returns {}.
  if (Object.keys(match.params).length > 0) {
    responseHeaders.set('X-Timber-Params', JSON.stringify(match.params));
  }

  return new Response(patchedStream, {
    status: 200,
    headers: responseHeaders,
  });
}
