/**
 * Proxy runner — executes app/proxy.ts before route matching.
 *
 * Supports two forms:
 * - Function: (req, next) => Promise<Response>
 * - Array: middleware functions composed left-to-right
 *
 * See design/07-routing.md §"proxy.ts — Global Middleware"
 */

/** Signature for a single proxy middleware function. */
export type ProxyFn = (req: Request, next: () => Promise<Response>) => Response | Promise<Response>;

/** The proxy.ts default export — either a function or an array of functions. */
export type ProxyExport = ProxyFn | ProxyFn[];

/**
 * Run the proxy pipeline.
 *
 * @param proxyExport - The default export from proxy.ts (function or array)
 * @param req - The incoming request
 * @param next - The continuation that proceeds to route matching and rendering
 * @returns The final response
 */
export async function runProxy(
  proxyExport: ProxyExport,
  req: Request,
  next: () => Promise<Response>
): Promise<Response> {
  const fns = Array.isArray(proxyExport) ? proxyExport : [proxyExport];

  // Compose left-to-right: first item's next() calls the second, etc.
  // The last item's next() calls the original `next` (route matching + render).
  let i = fns.length;
  let composed = next;
  while (i--) {
    const fn = fns[i]!;
    const downstream = composed;
    composed = () => Promise.resolve(fn(req, downstream));
  }

  return composed();
}
