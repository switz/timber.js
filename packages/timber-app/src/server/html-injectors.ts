/**
 * HTML stream injectors — TransformStreams that modify streamed HTML.
 *
 * These are extracted into a separate module so they can be tested
 * independently of rsc-entry.ts (which imports virtual modules).
 *
 * Design docs: 02-rendering-pipeline.md, 18-build-system.md §"Entry Files"
 */

/**
 * Inject HTML content before a closing tag in the stream.
 *
 * Streams chunks through immediately, keeping only a small trailing
 * buffer (the length of the target tag minus one) to handle the case
 * where the target tag spans two chunks. This preserves React's
 * streaming behavior for Suspense boundaries — chunks are not held
 * back waiting for the closing tag.
 */
function createInjector(
  stream: ReadableStream<Uint8Array>,
  content: string,
  targetTag: string,
  position: 'before' | 'after' = 'before'
): ReadableStream<Uint8Array> {
  if (!content) return stream;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let injected = false;
  // Keep a trailing buffer just large enough that the target tag
  // can't be split across the boundary without us seeing it.
  let tail = '';
  const tailLen = targetTag.length - 1;

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (injected) {
          controller.enqueue(chunk);
          return;
        }

        // Combine the trailing buffer with the new chunk
        const text = tail + decoder.decode(chunk, { stream: true });
        const tagIndex = text.indexOf(targetTag);

        if (tagIndex !== -1) {
          const splitPoint = position === 'before' ? tagIndex : tagIndex + targetTag.length;
          const before = text.slice(0, splitPoint);
          const after = text.slice(splitPoint);
          controller.enqueue(encoder.encode(before + content + after));
          injected = true;
          tail = '';
        } else {
          // Flush everything except the last tailLen chars (which might
          // be the start of the target tag split across chunks).
          const safeEnd = Math.max(0, text.length - tailLen);
          if (safeEnd > 0) {
            controller.enqueue(encoder.encode(text.slice(0, safeEnd)));
          }
          tail = text.slice(safeEnd);
        }
      },
      flush(controller) {
        if (!injected && tail) {
          controller.enqueue(encoder.encode(tail));
        }
      },
    })
  );
}

/**
 * Inject metadata elements before </head> in the HTML stream.
 *
 * If no </head> is found, the buffer is emitted as-is.
 */
export function injectHead(
  stream: ReadableStream<Uint8Array>,
  headHtml: string
): ReadableStream<Uint8Array> {
  return createInjector(stream, headHtml, '</head>');
}

/**
 * Inject client bootstrap scripts before </body> in the HTML stream.
 *
 * Returns the stream unchanged if scriptsHtml is empty (client JS disabled mode).
 * If no </body> is found, the buffer is emitted as-is.
 */
export function injectScripts(
  stream: ReadableStream<Uint8Array>,
  scriptsHtml: string
): ReadableStream<Uint8Array> {
  return createInjector(stream, scriptsHtml, '</body>');
}

/**
 * Escape a string for safe embedding inside a `<script>` tag within
 * a JSON-encoded value.
 *
 * Only needs to prevent `</script>` from closing the tag early and
 * handle U+2028/U+2029 (line/paragraph separators valid in JSON but
 * historically problematic in JS). Since we use JSON.stringify for the
 * outer encoding, we only escape `<` and the line separators.
 */
function htmlEscapeJsonString(str: string): string {
  return str
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Transform an RSC Flight stream into a stream of inline `<script>` tags.
 *
 * Uses a **pull-based** ReadableStream — the consumer (the injection
 * transform) drives reads from the RSC stream on demand. No background
 * reader, no shared mutable arrays, no race conditions.
 *
 * Each RSC chunk becomes:
 *   <script>(self.__timber_f=self.__timber_f||[]).push([1,"escaped_chunk"])</script>
 *
 * The first chunk emitted is the bootstrap signal [0] which the client
 * uses to initialize its buffer.
 *
 * Uses JSON-encoded typed tuples matching the pattern from Next.js:
 *   [0]        — bootstrap signal
 *   [1, data]  — RSC Flight data chunk (UTF-8 string)
 */
export function createInlinedRscStream(
  rscStream: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const rscReader = rscStream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Emit bootstrap signal — tells the client that __timber_f is active
      const bootstrap = `<script>(self.__timber_f=self.__timber_f||[]).push(${htmlEscapeJsonString(JSON.stringify([0]))})</script>`;
      controller.enqueue(encoder.encode(bootstrap));
    },
    async pull(controller) {
      try {
        const { done, value } = await rscReader.read();
        if (done) {
          controller.close();
          return;
        }
        if (value) {
          const decoded = decoder.decode(value, { stream: true });
          const escaped = htmlEscapeJsonString(JSON.stringify([1, decoded]));
          controller.enqueue(encoder.encode(`<script>self.__timber_f.push(${escaped})</script>`));
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Merge an RSC script stream into the HTML stream.
 *
 * This is a TransformStream that passes HTML chunks through and
 * interleaves RSC `<script>` tag chunks between them. The RSC stream
 * is pulled on demand — when an HTML chunk arrives, we yield it, then
 * give the RSC stream a chance to produce script tags that get appended.
 *
 * On flush (HTML stream ends), we drain remaining RSC script chunks
 * so nothing is lost when Suspense boundaries resolve after the shell.
 *
 * Inspired by Next.js createFlightDataInjectionTransformStream.
 */
function createFlightInjectionTransform(
  rscScriptStream: ReadableStream<Uint8Array>
): TransformStream<Uint8Array, Uint8Array> {
  let pull: Promise<void> | null = null;
  let donePulling = false;

  function startOrContinuePulling(
    controller: TransformStreamDefaultController<Uint8Array>
  ): Promise<void> {
    if (!pull) {
      pull = pullLoop(controller);
    }
    return pull;
  }

  async function pullLoop(controller: TransformStreamDefaultController<Uint8Array>): Promise<void> {
    const reader = rscScriptStream.getReader();

    // Wait one microtask before starting to read RSC data.
    // This ensures the HTML shell chunk flushes first, so the browser
    // can start parsing HTML and executing the bootstrap script before
    // RSC data script tags arrive.
    await new Promise<void>((r) => setTimeout(r, 0));

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          donePulling = true;
          return;
        }
        controller.enqueue(value);
      }
    } catch (err) {
      controller.error(err);
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Pass HTML chunk through immediately
      controller.enqueue(chunk);
      // Start pulling RSC data if not already started
      startOrContinuePulling(controller);
    },
    flush(controller) {
      // HTML stream is done — drain remaining RSC chunks
      if (donePulling) return;
      return startOrContinuePulling(controller);
    },
  });
}

/**
 * Move `</body></html>` suffix to the end of the stream.
 *
 * React's renderToReadableStream emits `</body></html>` as part of
 * the shell, but Suspense replacement scripts and RSC data arrive
 * after it. This transform captures the suffix and re-emits it at
 * the very end so the final HTML is well-formed:
 *
 *   <shell>...</shell>
 *   <script>...suspense replacements...</script>
 *   <script>...RSC data...</script>
 *   </body></html>
 *
 * Without this, RSC script tags would appear after </html> which,
 * while browsers handle it, is technically invalid HTML.
 */
function createMoveSuffixStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const suffix = '</body></html>';
  const suffixBytes = encoder.encode(suffix);
  let foundSuffix = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (foundSuffix) {
        controller.enqueue(chunk);
        return;
      }

      const text = decoder.decode(chunk, { stream: true });
      const idx = text.indexOf(suffix);
      if (idx !== -1) {
        foundSuffix = true;
        // Emit everything before the suffix
        const before = text.slice(0, idx);
        const after = text.slice(idx + suffix.length);
        if (before) controller.enqueue(encoder.encode(before));
        // Emit any content after the suffix (shouldn't normally exist)
        if (after) controller.enqueue(encoder.encode(after));
      } else {
        controller.enqueue(chunk);
      }
    },
    flush(controller) {
      // Re-emit the suffix at the very end
      if (foundSuffix) {
        controller.enqueue(suffixBytes);
      }
    },
  });
}

/**
 * Progressively inline RSC Flight payload chunks into the HTML stream.
 *
 * Architecture (3 TransformStream pipeline):
 * 1. HTML stream → moveSuffix (captures </body></html>, re-emits at end)
 * 2. → flightInjection (merges RSC <script> tags between HTML chunks)
 * 3. → output (well-formed HTML with interleaved RSC data)
 *
 * The RSC stream is transformed into <script> tags via createInlinedRscStream
 * (pull-based, no shared mutable state) and merged into the HTML pipeline
 * via createFlightInjectionTransform.
 *
 * The client reads these script tags via `self.__timber_f` and feeds
 * them to `createFromReadableStream` for progressive hydration.
 * Stream completion is signaled by the DOMContentLoaded event on the
 * client side — no custom done flag needed.
 */
export function injectRscPayload(
  htmlStream: ReadableStream<Uint8Array>,
  rscStream: ReadableStream<Uint8Array> | undefined
): ReadableStream<Uint8Array> {
  if (!rscStream) return htmlStream;

  // Transform RSC binary stream → stream of <script> tags
  const rscScriptStream = createInlinedRscStream(rscStream);

  // Pipeline: inject RSC scripts → move suffix to end
  // Order matters: flightInjection must flush remaining RSC scripts
  // before moveSuffix re-emits </body></html> at the very end.
  return htmlStream
    .pipeThrough(createFlightInjectionTransform(rscScriptStream))
    .pipeThrough(createMoveSuffixStream());
}

/**
 * Client bootstrap configuration returned by buildClientScripts.
 *
 * - `bootstrapScriptContent`: Inline JS passed to React's renderToReadableStream
 *   as `bootstrapScriptContent`. React injects this as a non-deferred `<script>`
 *   in the shell HTML, so it executes immediately during parsing — even while
 *   Suspense boundaries are still streaming. Uses dynamic `import()` to kick off
 *   module loading, enabling hydration to start before the stream closes.
 *
 * - `preloadLinks`: `<link rel="modulepreload">` tags for production dependency
 *   preloading. Injected into `<head>` via injectHead so the browser starts
 *   downloading JS chunks early.
 */
export interface ClientBootstrapConfig {
  bootstrapScriptContent: string;
  preloadLinks: string;
}

/** Find a manifest entry by matching the key suffix (e.g. 'client/browser-entry.ts'). */
function findManifestEntry(map: Record<string, string>, suffix: string): string | undefined {
  for (const [key, value] of Object.entries(map)) {
    if (key.endsWith(suffix)) return value;
  }
  return undefined;
}

/** Find a manifest array entry by matching the key suffix. */
function findManifestEntryArray(map: Record<string, string[]>, suffix: string): string[] | undefined {
  for (const [key, value] of Object.entries(map)) {
    if (key.endsWith(suffix)) return value;
  }
  return undefined;
}

/**
 * Build client bootstrap configuration based on runtime config.
 *
 * Returns empty strings when client JavaScript is disabled,
 * which produces zero-JS output. When `enableHMRInDev` is true and
 * running in dev mode, injects only the Vite HMR client (no app
 * bootstrap) so hot reloading works during development.
 *
 * In production, uses hashed chunk URLs from the build manifest.
 *
 * The bootstrap uses dynamic `import()` inside a regular (non-module)
 * inline script so it executes immediately during HTML parsing. This
 * is critical for streaming: `<script type="module">` is deferred
 * until the document finishes parsing, which blocks hydration behind
 * Suspense boundaries. Dynamic `import()` starts module loading and
 * execution as soon as the shell HTML is parsed.
 */
export function buildClientScripts(runtimeConfig: {
  output: string;
  clientJavascript: { disabled: boolean; enableHMRInDev: boolean };
  dev: boolean;
  buildManifest?: import('./build-manifest.js').BuildManifest;
}): ClientBootstrapConfig {
  if (runtimeConfig.clientJavascript.disabled) {
    // When client JS is disabled but enableHMRInDev is true in dev mode,
    // inject only the Vite HMR client for hot reloading CSS, etc.
    if (runtimeConfig.dev && runtimeConfig.clientJavascript.enableHMRInDev) {
      return {
        bootstrapScriptContent: 'import("/@vite/client")',
        preloadLinks: '',
      };
    }
    return { bootstrapScriptContent: '', preloadLinks: '' };
  }

  if (runtimeConfig.dev) {
    // Dev mode: Vite HMR client + RSC virtual browser entry.
    //
    // We import virtual:vite-rsc/entry-browser (the RSC plugin's browser
    // entry) instead of directly importing virtual:timber-browser-entry.
    // The RSC entry sets up React Fast Refresh globals ($RefreshReg$,
    // $RefreshSig$) BEFORE dynamically importing our browser entry
    // (resolved via the `entries.client` option we pass to the RSC plugin).
    // This ordering is critical — @vitejs/plugin-react's Babel transform
    // injects preamble checks into client components that expect these
    // globals to exist at module evaluation time.
    //
    // Dynamic import() ensures both scripts start loading immediately,
    // not deferred until document parsing completes.
    return {
      bootstrapScriptContent:
        'import("/@vite/client");import("/@id/__x00__virtual:vite-rsc/entry-browser")',
      preloadLinks: '',
    };
  }

  // Production: resolve browser entry to hashed chunk URL from manifest.
  // The manifest keys are facadeModuleIds — either root-relative paths or
  // absolute paths (when the entry lives outside the project root, e.g. in
  // a monorepo). Match by suffix to handle both cases.
  const manifest = runtimeConfig.buildManifest;
  const browserEntryUrl = manifest
    ? findManifestEntry(manifest.js, 'client/browser-entry.ts')
    : undefined;

  let preloadLinks = '';
  let bootstrapScriptContent: string;

  if (browserEntryUrl) {
    // Modulepreload hints for browser entry dependencies
    const preloads = (manifest ? findManifestEntryArray(manifest.modulepreload, 'client/browser-entry.ts') : undefined) ?? [];
    for (const url of preloads) {
      preloadLinks += `<link rel="modulepreload" href="${url}">`;
    }
    bootstrapScriptContent = `import("${browserEntryUrl}")`;
  } else {
    // Fallback: no manifest entry (e.g. manifest not yet populated)
    bootstrapScriptContent = 'import("/virtual:timber-browser-entry")';
  }

  return { bootstrapScriptContent, preloadLinks };
}
