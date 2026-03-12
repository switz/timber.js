# Philosophy

## What This Is

timber.js is a web framework built on Vite and React Server Components, written from scratch. It shares design goals with Vinext (Cloudflare's implementation of Next.js on Vite) but is an independent implementation with a different set of design values.

The shortest version: streaming should only be used for secondary or tertiary _slow_ content. Data layers for primary content should be fast–rails and php could do this, so can we. This gets you: correct HTTP semantics, real status codes, pages that work without JavaScript, genuine middleware, and streaming only where you explicitly ask for it in leafy components.

The goal is an RSC framework that makes more sense to the average developer — one that doesn't hide magic or strive to be smarter than the person wielding it, and that works well on dedicated servers where you actually control your CPU cycles and your data is close by. This document walks through the reasoning: why the framework exists, the design decisions we made and the ones we rejected, the problems we expect, and how we plan to build it.

Most of next.js' design decision stem from what we feel is a flawed premise: that "faster" is better. That streaming as soon as possible is the goal. That there should be aggressive caching at all layers of the stack. When in reality, doing so costs you both UX and DX.

For one, it means all pages return 200. It means you can't rewrite headers or use proper status codes. it means you have to think about and design loading states. Those loading states cause layout shift and lag. It means your site does not work with javascript disabled. Which is less about providing an experience to those without javascript, as it is reducing the chonk of your website. Websites that don't inject javascript to the initial rendering pipeline load cleaner and leaner. This means your pages load with all of their content already ready–no deluge of spinners and skeletons.

When you dig in deeper, what you find is that the difference between putting loading.tsx at the page level and moving it slightly further down is often roughly ~20ms. This whole decision is just papering over poorly designed data architectures and it comes at a cost. It was fine for rails/php apps – why are javascript apps any different? Early hints still gets your client javascript and css loading ASAP.

Primary content: like the url `/entity/1` should load from the database quickly. That drives 404, 401, and content headers like caching. Secondary or tertiary content can be deferred. Think `/feed` – if a tweet is "missing" from the feed, you don't 404 the page, you just don't render it. So there's less of a problem streaming it. You choose the flushing boundary.

By re-evaluating this simple premise, we redesign the app directory architecture ever so slightly. We get proper route middleware that can drive headers and status codes. We get pages that load with all of their content ready. We cut the javascript required to inject Suspense children. Pages actually feel and load leaner. That perceived (because it's not _real_) speed of streaming comes at the cost of content-layout-shift and anxiety.

No more loading.tsx. <Suspense> becomes opt-in only at the sub-page or sub-layout level.

---

## The Problem With Streaming Frameworks

Next.js, Remix, and SPAs all share a fundamental constraint: **they lie about HTTP status codes and don't work without javascript.**

Every response is HTTP 200. A page that 404s returns 200. A page that redirects returns 200. A page that throws an unhandled error returns 200. The actual outcome is communicated through the RSC payload, React error boundaries, or client-side JavaScript — invisible to anything that reads HTTP at face value.

This is not an oversight. It is structurally unavoidable in any framework that begins streaming before rendering is complete. HTTP requires the status line and headers to be sent before the body. If you start sending bytes before you know what the page contains — which is the entire point of streaming — you have already committed to a 200 by the time you discover the page needs to 404.

```
Streaming framework (Next.js, Vinext) — real-world timeline:

  Browser                          Network                        Server
  ───────                          ───────                        ──────
  t=0ms   → Request sent
  t=3ms   → DNS resolved
  t=30ms  → TCP connected
  t=60ms  → TLS handshake done
  t=60ms  → GET /dashboard HTTP/1.1
                                                                  t=62ms  → Request received
                                                                  t=62ms  → HTTP 200 + headers sent ← committed
                                                                  t=67ms  → <html><head>...
  t=65ms  ← First bytes arrive (TTFB)
                                                                  t=112ms → Root layout HTML sent
                                                                  t=142ms → Page discovers user is not authorized
                                                                             Too late. 200 is already on the wire.
                                                                             Can only signal via error boundary
                                                                             or client-side redirect.

timber.js — same request, blocking flush:

  Browser                          Network                        Server
  ───────                          ───────                        ──────
  t=0ms   → Request sent
  t=3ms   → DNS resolved
  t=30ms  → TCP connected
  t=60ms  → TLS handshake done
  t=60ms  → GET /dashboard HTTP/1.1
                                                                  t=62ms  → Request received
                                                                  t=62ms  → proxy.ts + middleware.ts run
                                                                  t=65ms  → Render begins, page calls requireUser()
                                                                  t=67ms  → Auth fails → 302 Location: /login
  t=70ms  ← 302 + headers arrive
            Browser redirects. No HTML parsed. No JS needed.
            CDN caches 302. APM logs it. curl follows it.

  — or if auth passes —
                                                                  t=65ms  → Render begins, page calls requireUser()
                                                                  t=67ms  → Auth passes (timber.cache hit)
                                                                  t=80ms  → Shell ready (onShellReady)
                                                                  t=80ms  → HTTP 200 + headers + shell flushed
  t=83ms  ← First bytes arrive (TTFB)
                                                                  t=120ms → <Suspense> content streams in
  t=123ms ← Suspense content arrives
```

The streaming framework commits its status code the instant the server touches the response — before it knows what the page contains. timber.js waits until the shell is fully rendered, so the status code is always accurate. The trade-off is ~20ms of additional server-side buffering before TTFB, in exchange for correct HTTP semantics and the website rendering largely complete.

The consequences are real:

- **Search engines** see 200 for deleted pages. Google does not deindex them.
- **CDNs and HTTP caches** cache 404s and redirects as 200s, serving stale content indefinitely.
- **APM tools and load balancers** report zero 4xx/5xx errors. Errors are invisible unless you instrument the RSC payload layer separately.
- **`curl`, scrapers, API clients** cannot act on status codes because they mean nothing.

timber.js fixes this by not committing the status code until the outcome is known.
