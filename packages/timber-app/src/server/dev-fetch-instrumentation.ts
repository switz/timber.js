/**
 * Dev-mode fetch instrumentation — patches globalThis.fetch to create OTEL
 * spans for every fetch call, giving visibility into async data fetching
 * in the dev request log tree.
 *
 * Only activated in dev mode — zero overhead in production.
 *
 * The spans are automatically children of the active OTEL context (e.g. a
 * timber.page or timber.layout span), so they appear nested under the
 * component that initiated the fetch in the dev log tree.
 *
 * Design ref: 17-logging.md §"Dev Logging", LOCAL-289
 */

import * as api from '@opentelemetry/api';

export type DevFetchCleanup = () => void;

/**
 * Patch globalThis.fetch to wrap every call in an OTEL span.
 *
 * Returns a cleanup function that restores the original fetch.
 * Only call this in dev mode.
 */
export function instrumentDevFetch(): DevFetchCleanup {
  const originalFetch = globalThis.fetch;
  const tracer = api.trace.getTracer('timber.js');

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { method, url } = extractFetchInfo(input, init);

    return tracer.startActiveSpan(
      'timber.fetch',
      {
        attributes: {
          'http.request.method': method,
          'http.url': url,
        },
      },
      async (span) => {
        try {
          const response = await originalFetch(input, init);

          span.setAttribute('http.response.status_code', response.status);

          // Surface cache status from standard headers
          const cacheStatus =
            response.headers.get('X-Cache') ?? response.headers.get('CF-Cache-Status');
          if (cacheStatus) {
            span.setAttribute('timber.cache_status', cacheStatus);
          }

          span.setStatus({ code: api.SpanStatusCode.OK });
          span.end();
          return response;
        } catch (error) {
          span.setStatus({ code: api.SpanStatusCode.ERROR });
          if (error instanceof Error) {
            span.setAttribute('timber.fetch_error', error.message);
            span.recordException(error);
          }
          span.end();
          throw error;
        }
      }
    );
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

/**
 * Extract method and URL from the various fetch() call signatures.
 */
function extractFetchInfo(
  input: RequestInfo | URL,
  init?: RequestInit
): { method: string; url: string } {
  let method = init?.method ?? 'GET';
  let url: string;

  if (input instanceof Request) {
    url = input.url;
    if (!init?.method) {
      method = input.method;
    }
  } else if (input instanceof URL) {
    url = input.toString();
  } else {
    url = input;
  }

  return { method: method.toUpperCase(), url };
}
