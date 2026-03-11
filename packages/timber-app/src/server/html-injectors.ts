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
  targetTag: string
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
          const before = text.slice(0, tagIndex);
          const after = text.slice(tagIndex);
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
 * Inline the RSC Flight payload into the HTML stream for client-side hydration.
 *
 * Reads the RSC stream in the background while passing HTML chunks through
 * immediately. When </body> is found, waits for the RSC stream to finish,
 * then injects a script with the escaped payload before </body>.
 *
 * This preserves React's streaming behavior — Suspense boundary flushes
 * are sent to the client as they resolve, not buffered until the end.
 *
 * If no rscStream is provided, returns the HTML stream unchanged.
 */
export function injectRscPayload(
  htmlStream: ReadableStream<Uint8Array>,
  rscStream: ReadableStream<Uint8Array> | undefined
): ReadableStream<Uint8Array> {
  if (!rscStream) return htmlStream;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const targetTag = '</body>';
  const tailLen = targetTag.length - 1;

  let tail = '';
  let injected = false;
  const rscChunks: string[] = [];
  let rscDone = false;
  const rscReader = rscStream.getReader();
  const rscDecoder = new TextDecoder();

  // Read the RSC stream to completion in the background.
  // Errors are caught to prevent unhandled promise rejections —
  // if the RSC stream errors (e.g. the tee'd source is cancelled),
  // we still produce valid HTML (just without the inline RSC payload).
  const rscPromise = (async () => {
    try {
      for (;;) {
        const { done, value } = await rscReader.read();
        if (done) break;
        rscChunks.push(rscDecoder.decode(value, { stream: true }));
      }
      const final = rscDecoder.decode();
      if (final) rscChunks.push(final);
    } catch {
      // RSC stream errored — proceed with whatever chunks we collected.
    }
    rscDone = true;
  })();

  return htmlStream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        if (injected) {
          controller.enqueue(chunk);
          return;
        }

        const text = tail + decoder.decode(chunk, { stream: true });
        const tagIndex = text.indexOf(targetTag);

        if (tagIndex !== -1) {
          // Wait for RSC stream to complete before injecting
          if (!rscDone) await rscPromise;

          const rscText = escapeForScript(rscChunks.join(''));
          const script =
            '<script>' +
            `window.__TIMBER_RSC_PAYLOAD='${rscText}'` +
            '</script>';

          const before = text.slice(0, tagIndex);
          const after = text.slice(tagIndex);
          controller.enqueue(encoder.encode(before + script + after));
          injected = true;
          tail = '';
        } else {
          // Pass through everything except the trailing chars that
          // might be the start of </body> split across chunks.
          const safeEnd = Math.max(0, text.length - tailLen);
          if (safeEnd > 0) {
            controller.enqueue(encoder.encode(text.slice(0, safeEnd)));
          }
          tail = text.slice(safeEnd);
        }
      },
      async flush(controller) {
        if (!injected && tail) {
          controller.enqueue(encoder.encode(tail));
        }
      },
    })
  );
}

/**
 * Build client bootstrap script tags based on runtime config.
 *
 * Returns an empty string when `output: 'static'` + `noJS: true`,
 * which produces zero-JS output. In dev mode, includes the Vite
 * HMR client script. In production, uses hashed chunk URLs from the
 * build manifest and includes modulepreload hints for dependencies.
 */
export function buildClientScripts(runtimeConfig: {
  output: string;
  noJS: boolean;
  dev: boolean;
  buildManifest?: import('./build-manifest.js').BuildManifest;
}): string {
  if (runtimeConfig.output === 'static' && runtimeConfig.noJS) {
    return '';
  }

  let scripts = '';

  if (runtimeConfig.dev) {
    // Dev mode: Vite HMR client + virtual module path
    scripts += '<script type="module" src="/@vite/client"></script>';
    scripts += '<script type="module" src="/@id/virtual:timber-browser-entry"></script>';
    return scripts;
  }

  // Production: resolve browser entry to hashed chunk URL from manifest
  const manifest = runtimeConfig.buildManifest;
  const browserEntryUrl = manifest?.js['virtual:timber-browser-entry'];

  if (browserEntryUrl) {
    // Modulepreload hints for browser entry dependencies
    const preloads = manifest?.modulepreload['virtual:timber-browser-entry'] ?? [];
    for (const url of preloads) {
      scripts += `<link rel="modulepreload" href="${url}">`;
    }
    scripts += `<script type="module" src="${browserEntryUrl}"></script>`;
  } else {
    // Fallback: no manifest entry (e.g. manifest not yet populated)
    scripts += '<script type="module" src="/virtual:timber-browser-entry"></script>';
  }

  return scripts;
}
