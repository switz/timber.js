# Security

This document consolidates timber.js's security model. Each section references the design document where the mechanism is specified.

## Principles

1. **Single decode, single representation.** URLs are decoded once at the request boundary. Every layer sees the same canonical path. No re-decoding. See [Routing — URL Canonicalization](07-routing.md#url-canonicalization--security).

2. **No global fallback state.** If `AsyncLocalStorage` is unavailable, the request fails — it does not fall back to a shared object. See [Platform](11-platform.md#platform-target).

3. **Auth always runs.** `access.ts` executes on every navigation regardless of cached layouts, mounted state trees, or segment diffing. See [Authorization](04-authorization.md#accessts-runs-on-every-navigation).

4. **Errors don't leak.** Unexpected exceptions return `{ code: 'INTERNAL_ERROR' }` to the client. `RenderError` requires explicit opt-in for any data that crosses the RSC boundary. See [Error Handling](10-error-handling.md).

5. **Redirects are relative-only.** `redirect()` rejects absolute and protocol-relative URLs. External redirects require `redirectExternal()` with an allow-list. See [Forms — Security](08-forms-and-actions.md#security).

6. **CSRF protection by default.** Server actions validate the `Origin` header. See [Forms — Security](08-forms-and-actions.md#csrf-protection).

7. **Server source never reaches the client.** React Flight's debug channel is routed to a discard sink so server component function bodies are never serialized into the RSC payload sent to browsers. See [Rendering Pipeline](02-rendering-pipeline.md).

## Vulnerability Classes Addressed

These are the specific attack classes that timber.js's design mitigates (identified through security analysis of the RSC-on-Vite design space):

| #     | Vulnerability Class                                | Mitigation                                                                                            | Design Doc                                     |
| ----- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1–4   | Cross-request state pollution via global fallback  | No global fallback; ALS-only; `React.cache` per-request                                               | [Platform](11-platform.md)                     |
| 5     | Cache poisoning via missing auth in cache key      | No patched `fetch`; explicit `timber.cache` keys with SHA-256                                         | [Caching](06-caching.md)                       |
| 6–10  | Path traversal / double-decode middleware bypass   | Single decode at boundary; encoded separators rejected; path normalization                            | [Routing](07-routing.md)                       |
| 11    | Middleware bypass via regex                        | Function-based `proxy.ts`, no regex matchers                                                          | [Routing](07-routing.md)                       |
| 13    | API routes excluded from middleware                | `proxy.ts` runs on every request, no exclusions                                                       | [Routing](07-routing.md)                       |
| 16    | Image endpoint bypasses middleware                 | No image optimization endpoint; all framework endpoints go through `proxy.ts`                         | [Routing](07-routing.md)                       |
| 20–21 | Open redirect via image proxy / middleware rewrite | `redirect()` relative-only; `redirectExternal()` with allow-list                                      | [Forms](08-forms-and-actions.md)               |
| 22    | XSS via Link component URL scheme                  | `<Link>` rejects `javascript:`, `data:`, `vbscript:`                                                  | [Routing](07-routing.md)                       |
| 24    | Cache key collision via weak hash                  | SHA-256 for default cache keys                                                                        | [Caching](06-caching.md)                       |
| 25    | Server component source leak via RSC debug channel | `debugChannel` sink separates debug data from client payload; source code never inlined               | [Rendering Pipeline](02-rendering-pipeline.md) |
| 26    | Middleware header deletion bypass                  | `headers()` returns frozen proxy; middleware overlay is additive-only; original request never mutated | [Routing](07-routing.md)                       |
| 27    | Cookie mutation in unsafe context                  | `cookies().set()` throws in RSC/access.ts; post-flush writes silently dropped; secure defaults        | [Cookies](29-cookies.md)                       |
| 28    | Cookie without secure flags                        | Default: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`; developer opts out explicitly               | [Cookies](29-cookies.md)                       |

## Middleware Header Immutability

Middleware cannot delete or silently modify request headers that downstream handlers (access checks, server components, server actions) rely on for auth. This is enforced at three layers:

1. **`headers()` is frozen.** The `headers()` function returns a Proxy-wrapped `Headers` object. Calling `.set()`, `.append()`, or `.delete()` throws a runtime error. Downstream code cannot mutate request headers.

2. **Middleware overlay is additive-only.** `ctx.requestHeaders` in `middleware.ts` is a fresh `Headers` object — an overlay merged on top of the original request headers after middleware completes. Middleware can add or override headers, but the operation is explicit and auditable. The original request headers are preserved in the ALS store and are never mutated.

3. **Original `Request` is immutable.** `ctx.req` in middleware is the original `Request` object. `Request.headers` is read-only per the web spec. The pipeline always uses the original request for route matching and rendering — `proxy.ts` cannot replace it.

4. **`proxy.ts` cannot swap the request.** The proxy function receives `(req, next)` and controls the response via `next()`. The `req` passed to `handleRequest()` is captured by closure from the original request — the proxy cannot substitute a different request object into the pipeline.

This architecture is structurally immune to the Vinext-style middleware header deletion bypass, where middleware could delete `Authorization` or session headers before they reached auth handlers.

## Security Testing Checklist

| #   | Category                        | Test                                                                       | Expected                                                   |
| --- | ------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | URL canonicalization            | `GET /%2561dmin`                                                           | Decoded once to `/%61dmin`, not `/admin`                   |
| 2   | Path traversal                  | `GET /foo/..%2fadmin`                                                      | 400 (encoded separator rejected)                           |
| 3   | Null bytes                      | `GET /foo%00bar`                                                           | 400                                                        |
| 4   | Backslash confusion             | `GET /\evil.com`                                                           | 400 or treated as literal path segment, not `//evil.com`   |
| 5   | Cross-request isolation         | 20 concurrent requests with different session cookies                      | No state leakage between requests                          |
| 6   | CSRF                            | `POST` server action without `Origin` header                               | 403                                                        |
| 7   | Open redirect                   | `redirect('https://evil.com')` in action                                   | Error thrown                                               |
| 8   | Protocol-relative redirect      | `redirect('//evil.com')`                                                   | Error thrown                                               |
| 9   | Link scheme injection           | `<Link href="javascript:alert(1)">`                                        | Rejected at render; dev warning                            |
| 10  | Middleware coverage             | Request to RSC payload endpoint                                            | `proxy.ts` executes                                        |
| 11  | State tree manipulation         | Fabricated `X-Timber-State-Tree` claiming all segments mounted             | All `access.ts` files still execute                        |
| 12  | Schema validation               | Malformed input to `.schema()` action                                      | `validationErrors` returned; action body never runs        |
| 13  | Error leakage                   | Unexpected `throw new Error('secret')` in action                           | Client receives `{ code: 'INTERNAL_ERROR' }`, no message   |
| 14  | Cache key determinism           | `timber.cache(fn)` called with `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }`       | Same cache key                                             |
| 15  | `"use cache"` user data leak    | Component with user-derived props + `"use cache"`                          | Dev-mode warning emitted                                   |
| 16  | FormData limits                 | Request body exceeding configured limit                                    | 413                                                        |
| 16b | FormData limits (no length)     | Action/upload POST without `Content-Length` header                          | 411 Length Required                                        |
| 17  | Codec ReDoS                     | Pathological search-param input to codec `.parse()`                        | Completes in <100ms                                        |
| 18  | `deny()` status                 | `access.ts` calls `deny()` outside Suspense                                | HTTP 403, `403.tsx` rendered                               |
| 19  | `deny(401)` status              | `access.ts` calls `deny(401)` outside Suspense                             | HTTP 401, `401.tsx` rendered                               |
| 20  | `deny()` in Suspense            | `deny()` called inside post-flush `<Suspense>`                             | Dev warning, error boundary rendered, status already 200   |
| 21  | Slot access `redirect()`        | Slot `access.ts` calls `redirect()`                                        | Dev-mode error — only `deny()` allowed in slot access      |
| 22  | API route auth                  | `GET /api/users` with no session, segment has `access.ts`                  | `access.ts` runs, returns 401/redirect                     |
| 23  | RSC source leak                 | Initial HTML and RSC navigation payload inspected for `$E` function bodies | No server component source code in client-visible payloads |
| 24  | Header mutation in render       | `headers().set('Authorization', 'x')` in server component                  | Throws "read-only" error                                   |
| 25  | Header deletion in render       | `headers().delete('Authorization')` in server component                    | Throws "read-only" error                                   |
| 26  | Middleware overlay immutability | Middleware sets `ctx.requestHeaders`, original `req.headers` inspected     | Original request headers unchanged                         |
| 27  | Proxy request substitution      | `proxy.ts` creates modified Request, `headers()` checked in render         | Render sees original request headers, not proxy's          |
| 28  | Cookie set in RSC               | `cookies().set('x', 'y')` in a server component                            | Throws descriptive error                                   |
| 29  | Cookie set in access.ts         | `cookies().set('x', 'y')` in an access.ts file                             | Throws descriptive error                                   |
| 30  | Cookie set after flush           | `cookies().set()` called after `onShellReady`                               | Dev warning, cookie silently dropped                       |
| 31  | Cookie secure defaults           | `cookies().set('name', 'value')` with no options                            | `HttpOnly; Secure; SameSite=Lax; Path=/`                   |
| 32  | Signed cookie tampering          | Modified signed cookie value read via `cookies().getSigned()`               | Returns `undefined`                                        |
