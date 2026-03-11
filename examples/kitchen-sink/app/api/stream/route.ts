import type { RouteContext } from '@timber/app/server';

export async function GET(ctx: RouteContext) {
  const encoder = new TextEncoder();
  let count = 0;
  const max = 3;

  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(() => {
        count++;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ n: count })}\n\n`));
        if (count >= max) {
          clearInterval(interval);
          controller.close();
        }
      }, 50);

      ctx.req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
