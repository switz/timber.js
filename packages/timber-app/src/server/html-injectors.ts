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
 * Returns the stream unchanged if scriptsHtml is empty (noJS mode).
 * If no </body> is found, the buffer is emitted as-is.
 */
export function injectScripts(
  stream: ReadableStream<Uint8Array>,
  scriptsHtml: string
): ReadableStream<Uint8Array> {
  return createInjector(stream, scriptsHtml, '</body>');
}

/**
 * Escape a string for safe embedding inside a `<script>` tag as a
 * single-quoted string literal.
 *
 * Escapes backslashes, single quotes, newlines (`\n`, `\r`), `<`
 * (prevents `</script>` from closing the tag early), and U+2028/U+2029
 * (line/paragraph separators that are valid in JSON but invalid in JS
 * string literals).
 */
function escapeForScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/</g, '\\x3c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Progressively inline RSC Flight payload chunks into the HTML stream.
 *
 * Instead of buffering the entire RSC payload and injecting it as one
 * blob before </body>, this interleaves RSC chunks with HTML chunks as
 * they arrive. Each RSC chunk becomes an inline script tag:
 *
 *   <script>self.__timber_f.push('escaped_chunk')</script>
 *
 * The client-side browser entry sets up a ReadableStream controller on
 * `self.__timber_f.push` so chunks feed into `createFromReadableStream`
 * progressively, enabling hydration to start before all Suspense
 * boundaries have resolved.
 *
 * If no rscStream is provided, returns the HTML stream unchanged.
 */
export function injectRscPayload(
  htmlStream: ReadableStream<Uint8Array>,
  rscStream: ReadableStream<Uint8Array> | undefined
): ReadableStream<Uint8Array> {
  if (!rscStream) return htmlStream;

  const encoder = new TextEncoder();
  const htmlDecoder = new TextDecoder();
  const rscReader = rscStream.getReader();
  const rscDecoder = new TextDecoder();

  // Pending RSC chunks that arrived between HTML chunks.
  // Drained on every HTML transform call and on flush.
  const pendingRsc: string[] = [];
  let rscDone = false;

  // Read the RSC stream in the background, accumulating chunks
  // that will be flushed alongside the next HTML chunk.
  const rscPromise = (async () => {
    try {
      for (;;) {
        const { done, value } = await rscReader.read();
        if (done) break;
        pendingRsc.push(rscDecoder.decode(value, { stream: true }));
      }
      const final = rscDecoder.decode();
      if (final) pendingRsc.push(final);
    } catch {
      // RSC stream errored — emit whatever chunks we collected.
    }
    rscDone = true;
  })();

  /** Build <script> tags for all pending RSC chunks and clear the queue. */
  function drainPendingRsc(): string {
    if (pendingRsc.length === 0) return '';
    let scripts = '';
    for (const chunk of pendingRsc) {
      scripts += `<script>(self.__timber_f=self.__timber_f||[]).push('${escapeForScript(chunk)}')</script>`;
    }
    pendingRsc.length = 0;
    return scripts;
  }

  const targetTag = '</body>';
  let foundBody = false;
  let doneEmitted = false;

  return htmlStream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (foundBody) {
          controller.enqueue(chunk);
          return;
        }

        const text = htmlDecoder.decode(chunk, { stream: true });
        const tagIndex = text.indexOf(targetTag);

        if (tagIndex !== -1) {
          // Found </body> — flush pending RSC + done signal before it.
          const before = text.slice(0, tagIndex);
          const after = text.slice(tagIndex);
          const rscScripts = drainPendingRsc();
          let doneSignal = '';
          if (rscDone && !doneEmitted) {
            doneSignal = '<script>self.__timber_f_done=1</script>';
            doneEmitted = true;
          }
          controller.enqueue(encoder.encode(before + rscScripts + doneSignal + after));
          foundBody = true;
        } else {
          // Pass HTML chunk through as-is, then append any pending
          // RSC payload chunks that arrived since the last HTML chunk.
          controller.enqueue(chunk);
          const rscScripts = drainPendingRsc();
          if (rscScripts) {
            controller.enqueue(encoder.encode(rscScripts));
          }
        }
      },
      async flush(controller) {
        // Wait for RSC stream to finish and flush any remaining chunks.
        if (!rscDone) await rscPromise;
        if (doneEmitted) return;
        const rscScripts = drainPendingRsc();
        const doneSignal = '<script>self.__timber_f_done=1</script>';
        if (rscScripts) {
          controller.enqueue(encoder.encode(rscScripts + doneSignal));
        } else {
          controller.enqueue(encoder.encode(doneSignal));
        }
      },
    })
  );
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

/**
 * Build client bootstrap configuration based on runtime config.
 *
 * Returns empty strings when `output: 'static'` + `noJS: true`,
 * which produces zero-JS output. In dev mode, imports the Vite
 * HMR client and virtual browser entry. In production, uses hashed
 * chunk URLs from the build manifest.
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
  noJS: boolean;
  dev: boolean;
  buildManifest?: import('./build-manifest.js').BuildManifest;
}): ClientBootstrapConfig {
  if (runtimeConfig.output === 'static' && runtimeConfig.noJS) {
    return { bootstrapScriptContent: '', preloadLinks: '' };
  }

  if (runtimeConfig.dev) {
    // Dev mode: Vite HMR client + virtual module path.
    // Dynamic import() ensures both scripts start loading immediately,
    // not deferred until document parsing completes.
    return {
      bootstrapScriptContent: 'import("/@vite/client");import("/@id/virtual:timber-browser-entry")',
      preloadLinks: '',
    };
  }

  // Production: resolve browser entry to hashed chunk URL from manifest
  const manifest = runtimeConfig.buildManifest;
  const browserEntryUrl = manifest?.js['virtual:timber-browser-entry'];

  let preloadLinks = '';
  let bootstrapScriptContent: string;

  if (browserEntryUrl) {
    // Modulepreload hints for browser entry dependencies
    const preloads = manifest?.modulepreload['virtual:timber-browser-entry'] ?? [];
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
