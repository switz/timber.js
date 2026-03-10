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
 * Buffers chunks until the target tag is found, then injects the
 * content immediately before it. If the tag is never found, the
 * buffer is flushed as-is.
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
  let buffer = '';

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (injected) {
          controller.enqueue(chunk);
          return;
        }

        buffer += decoder.decode(chunk, { stream: true });
        const tagIndex = buffer.indexOf(targetTag);

        if (tagIndex !== -1) {
          const before = buffer.slice(0, tagIndex);
          const after = buffer.slice(tagIndex);
          controller.enqueue(encoder.encode(before + content + after));
          injected = true;
          buffer = '';
        }
        // Otherwise keep buffering — target tag may span chunks
      },
      flush(controller) {
        if (!injected && buffer) {
          controller.enqueue(encoder.encode(buffer));
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
 * Escapes backslashes, single quotes, `<` (prevents `</script>` from
 * closing the tag early), and U+2028/U+2029 (line/paragraph separators
 * that are valid in JSON but invalid in JS string literals).
 */
function escapeForScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\x3c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Inline the RSC Flight payload into the HTML stream for client-side hydration.
 *
 * Reads the RSC stream, collects it as a UTF-8 string, and injects a script
 * before </body> that sets window.__TIMBER_RSC_PAYLOAD to the escaped text.
 * The browser entry wraps this in a ReadableStream for createFromReadableStream.
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

  // We need to collect the RSC payload and inject it when we see </body>.
  // Buffer the HTML stream until we find </body>, then inject the RSC script.
  let htmlBuffer = '';
  let htmlInjected = false;
  const rscChunks: string[] = [];
  let rscDone = false;
  const rscReader = rscStream.getReader();
  const rscDecoder = new TextDecoder();

  // Read the RSC stream to completion in the background
  const rscPromise = (async () => {
    for (;;) {
      const { done, value } = await rscReader.read();
      if (done) break;
      rscChunks.push(rscDecoder.decode(value, { stream: true }));
    }
    // Flush any remaining bytes from the streaming decoder
    const final = rscDecoder.decode();
    if (final) rscChunks.push(final);
    rscDone = true;
  })();

  return htmlStream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        if (htmlInjected) {
          controller.enqueue(chunk);
          return;
        }

        htmlBuffer += decoder.decode(chunk, { stream: true });
        const tagIndex = htmlBuffer.indexOf('</body>');

        if (tagIndex !== -1) {
          // Wait for RSC stream to complete before injecting
          if (!rscDone) await rscPromise;

          const rscText = escapeForScript(rscChunks.join(''));

          const script =
            '<script>' +
            `window.__TIMBER_RSC_PAYLOAD='${rscText}'` +
            '</script>';

          const before = htmlBuffer.slice(0, tagIndex);
          const after = htmlBuffer.slice(tagIndex);
          controller.enqueue(encoder.encode(before + script + after));
          htmlInjected = true;
          htmlBuffer = '';
        }
      },
      async flush(controller) {
        if (!htmlInjected && htmlBuffer) {
          controller.enqueue(encoder.encode(htmlBuffer));
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
 * HMR client script.
 */
export function buildClientScripts(runtimeConfig: {
  output: string;
  noJS: boolean;
  dev: boolean;
}): string {
  if (runtimeConfig.output === 'static' && runtimeConfig.noJS) {
    return '';
  }

  let scripts = '';
  if (runtimeConfig.dev) {
    scripts += '<script type="module" src="/@vite/client"></script>';
  }
  // In dev mode, use /@id/ prefix so Vite's dev middleware resolves the
  // virtual module through the plugin pipeline. In production, the build
  // step resolves it to a real chunk path.
  const browserEntryPath = runtimeConfig.dev
    ? '/@id/virtual:timber-browser-entry'
    : '/virtual:timber-browser-entry';
  scripts += `<script type="module" src="${browserEntryPath}"></script>`;
  return scripts;
}
