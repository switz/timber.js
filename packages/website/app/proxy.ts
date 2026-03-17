// @ts-expect-error no turndown types
import TurndownService from 'turndown';

const turndownService = new TurndownService();

export default [
  async (req: Request, next: () => Promise<Response>) => {
    // wrap the request
    const response = await next();

    if (req.headers.get('Accept') === 'text/markdown') {
      const html = await response.text();
      const markdown = turndownService.turndown(html);

      return new Response(markdown, {
        status: 203, // non-authoritative response
        headers: { 'Content-Type': 'text/markdown' },
      });
    }

    return response;
  },
];
