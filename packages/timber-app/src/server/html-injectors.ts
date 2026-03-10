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
 * Inline the RSC Flight payload into the HTML stream for client-side hydration.
 *
 * Reads the RSC stream, base64-encodes the bytes, and injects a script before
 * </body> that creates window.__TIMBER_RSC_PAYLOAD as a ReadableStream.
 * The browser entry decodes this via createFromReadableStream to hydrate
 * the React tree without a second server round-trip.
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
  const rscChunks: Uint8Array[] = [];
  let rscDone = false;
  const rscReader = rscStream.getReader();

  // Read the RSC stream to completion in the background
  const rscPromise = (async () => {
    for (;;) {
      const { done, value } = await rscReader.read();
      if (done) break;
      rscChunks.push(value);
    }
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

          // Concatenate RSC chunks and base64-encode
          const totalLen = rscChunks.reduce((sum, c) => sum + c.length, 0);
          const combined = new Uint8Array(totalLen);
          let offset = 0;
          for (const c of rscChunks) {
            combined.set(c, offset);
            offset += c.length;
          }

          // Encode RSC bytes as a comma-separated list of byte values.
          // This avoids base64 decoding complexity on the client and works
          // with any binary content in the RSC stream.
          const byteStr = Array.from(combined).join(',');

          const script =
            '<script>' +
            '(function(){' +
            `var d=new Uint8Array([${byteStr}]);` +
            'var s=new ReadableStream({start:function(c){c.enqueue(d);c.close();}});' +
            'window.__TIMBER_RSC_PAYLOAD=s;' +
            '})()' +
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

