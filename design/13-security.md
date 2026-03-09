# Security

This document consolidates timber.js's security model. Each section references the design document where the mechanism is specified.

## Principles

1. **Single decode, single representation.** URLs are decoded once at the request boundary. Every layer sees the same canonical path. No re-decoding. See [Routing — URL Canonicalization](07-routing.md#url-canonicalization--security).

2. **No global fallback state.** If `AsyncLocalStorage` is unavailable, the request fails — it does not fall back to a shared object. See [Platform](11-platform.md#platform-target).

3. **Auth always runs.** `access.ts` executes on every navigation regardless of cached layouts, mounted state trees, or segment diffing. See [Authorization](04-authorization.md#accessts-runs-on-every-navigation).

4. **Errors don't leak.** Unexpected exceptions return `{ code: 'INTERNAL_ERROR' }` to the client. `RenderError` requires explicit opt-in for any data that crosses the RSC boundary. See [Error Handling](10-error-handling.md).

5. **Redirects are relative-only.** `redirect()` rejects absolute and protocol-relative URLs. External redirects require `redirectExternal()` with an allow-list. See [Forms — Security](08-forms-and-actions.md#security).

6. **CSRF protection by default.** Server actions validate the `Origin` header. See [Forms — Security](08-forms-and-actions.md#csrf-protection).

## Vulnerability Classes Addressed

These are the specific attack classes from the vinext security audit that timber.js's design mitigates:

| # | Vulnerability Class | Mitigation | Design Doc |
|---|---|---|---|
| 1–4 | Cross-request state pollution via global fallback | No global fallback; ALS-only; `React.cache` per-request | [Platform](11-platform.md) |
| 5 | Cache poisoning via missing auth in cache key | No patched `fetch`; explicit `timber.cache` keys with SHA-256 | [Caching](06-caching.md) |
| 6–10 | Path traversal / double-decode middleware bypass | Single decode at boundary; encoded separators rejected; path normalization | [Routing](07-routing.md) |
| 11 | Middleware bypass via regex | Function-based `proxy.ts`, no regex matchers | [Routing](07-routing.md) |
| 13 | API routes excluded from middleware | `proxy.ts` runs on every request, no exclusions | [Routing](07-routing.md) |
| 16 | Image endpoint bypasses middleware | No image optimization endpoint; all framework endpoints go through `proxy.ts` | [Routing](07-routing.md) |
| 20–21 | Open redirect via image proxy / middleware rewrite | `redirect()` relative-only; `redirectExternal()` with allow-list | [Forms](08-forms-and-actions.md) |
| 22 | XSS via Link component URL scheme | `<Link>` rejects `javascript:`, `data:`, `vbscript:` | [Routing](07-routing.md) |
| 24 | Cache key collision via weak hash | SHA-256 for default cache keys | [Caching](06-caching.md) |

## Security Testing Checklist

| # | Category | Test | Expected |
|---|---|---|---|
| 1 | URL canonicalization | `GET /%2561dmin` | Decoded once to `/%61dmin`, not `/admin` |
| 2 | Path traversal | `GET /foo/..%2fadmin` | 400 (encoded separator rejected) |
| 3 | Null bytes | `GET /foo%00bar` | 400 |
| 4 | Backslash confusion | `GET /\evil.com` | 400 or treated as literal path segment, not `//evil.com` |
| 5 | Cross-request isolation | 20 concurrent requests with different session cookies | No state leakage between requests |
| 6 | CSRF | `POST` server action without `Origin` header | 403 |
| 7 | Open redirect | `redirect('https://evil.com')` in action | Error thrown |
| 8 | Protocol-relative redirect | `redirect('//evil.com')` | Error thrown |
| 9 | Link scheme injection | `<Link href="javascript:alert(1)">` | Rejected at render; dev warning |
| 10 | Middleware coverage | Request to RSC payload endpoint | `proxy.ts` executes |
| 11 | State tree manipulation | Fabricated `X-Timber-State-Tree` claiming all segments mounted | All `access.ts` files still execute |
| 12 | Schema validation | Malformed input to `.schema()` action | `validationErrors` returned; action body never runs |
| 13 | Error leakage | Unexpected `throw new Error('secret')` in action | Client receives `{ code: 'INTERNAL_ERROR' }`, no message |
| 14 | Cache key determinism | `timber.cache(fn)` called with `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` | Same cache key |
| 15 | `"use cache"` user data leak | Component with user-derived props + `"use cache"` | Dev-mode warning emitted |
| 16 | FormData limits | Request body exceeding configured limit | 413 |
| 17 | Codec ReDoS | Pathological search-param input to codec `.parse()` | Completes in <100ms |
| 18 | `deny()` status | `access.ts` calls `deny()` outside Suspense | HTTP 403, `403.tsx` rendered |
| 19 | `deny(401)` status | `access.ts` calls `deny(401)` outside Suspense | HTTP 401, `401.tsx` rendered |
| 20 | `deny()` in Suspense | `deny()` called inside post-flush `<Suspense>` | Dev warning, error boundary rendered, status already 200 |
| 21 | Slot access `redirect()` | Slot `access.ts` calls `redirect()` | Dev-mode error — only `deny()` allowed in slot access |
| 22 | API route auth | `GET /api/users` with no session, segment has `access.ts` | `access.ts` runs, returns 401/redirect |
