# Benchmarking: timber.js vs Next.js

## Overview

This document captures benchmarking methodology, findings, and lessons from comparing timber.js against Next.js using [relisten.net](https://relisten.net) (Next.js) and [timber.relisten.net](https://timber.relisten.net) (timber.js) — the same application, same data, same infrastructure.

## Test Environment

Both apps run on the same Kubernetes cluster behind the same Cloudflare proxy:

|                    | timber.js                      | Next.js                             |
| ------------------ | ------------------------------ | ----------------------------------- |
| **Pods**           | 1                              | 2                                   |
| **Container port** | 3000                           | 3000                                |
| **Ingress**        | nginx ingress                  | nginx ingress                       |
| **CDN**            | Cloudflare (same zone)         | Cloudflare (same zone)              |
| **Data source**    | relisten API (same endpoints)  | relisten API (same endpoints)       |
| **Caching**        | `timber.cache` + `React.cache` | Next.js fetch cache + `React.cache` |

## Key Findings

### Latency (warm cache, `hyperfine --warmup 3 --runs 20`)

| Route                       | Timber          | Next.js         | Winner        |
| --------------------------- | --------------- | --------------- | ------------- |
| `/` (homepage)              | 1,147ms ± 966   | **771ms ± 503** | Next.js 1.49x |
| `/grateful-dead`            | **717ms ± 444** | 878ms ± 562     | Timber 1.18x  |
| `/grateful-dead/1977`       | **320ms ± 19**  | 340ms ± 56      | Timber 1.14x  |
| `/grateful-dead/1977/05/08` | **338ms ± 20**  | 412ms ± 145     | Timber 1.09x  |

Timber wins 3 of 4 routes. On sub-pages, timber is significantly more consistent (σ of 19-20ms vs 56-145ms). The homepage is slower with high variance — likely a cache warming issue since `/` loads the most data.

### Under Load (100 requests, 10 concurrent via `hey`)

|                    | Timber           | Next.js         |
| ------------------ | ---------------- | --------------- |
| **p50**            | 1,116ms          | 957ms           |
| **p90**            | 1,402ms          | 1,992ms         |
| **Latency spread** | Tight (1.0-1.5s) | Wide (0.2-2.0s) |
| **req/sec**        | 8.5              | 8.8             |

Similar throughput but timber has much tighter latency distribution under concurrent load.

### RSC Payload Size (client navigation)

|                     | Timber | Next.js |
| ------------------- | ------ | ------- |
| **Uncompressed**    | 994 KB | 995 KB  |
| **Compressed (br)** | 117 KB | 117 KB  |
| **Flight rows**     | 41     | 39      |

Virtually identical — no overhead from timber's RSC format.

### JS Bundle Size

|                     | Timber | Next.js |
| ------------------- | ------ | ------- |
| **Total JS (br)**   | 256 KB | 398 KB  |
| **Unique JS files** | 10     | 24      |

Timber ships 36% less JavaScript with fewer network requests.

### Initial HTML Response

|                        | Timber   | Next.js  |
| ---------------------- | -------- | -------- |
| **Uncompressed**       | 1,676 KB | 1,321 KB |
| **Compressed (br)**    | 82 KB    | 127 KB   |
| **Inline RSC payload** | 951 KB   | 662 KB   |

Timber's uncompressed HTML is larger (more inline RSC data) but compresses better — 35% smaller on the wire.

## Production Debugging: The 103 Early Hints Incident

### Symptom

23% of requests to timber.relisten.net stalled for 5-6 seconds. Next.js on the same infrastructure never exhibited this.

### Root Cause

Timber's node-server adapter sent `HTTP/1.1 103 Early Hints` as an informational response before the 200. The nginx ingress controller (v1.25.5) proxies to upstream pods over HTTP/1.1 and does not have `proxy_pass_early_hints` enabled. Nginx intermittently treated the 103 as a malformed response, triggering `proxy_next_upstream` retry logic after `proxy_connect_timeout` (5 seconds).

Next.js never had this problem because it only sets `Link` headers on the 200 response — Cloudflare converts those to 103 at the edge over HTTP/2 to the browser.

### Fix

Disabled application-level 103 Early Hints for the `node-server` and `bun` Nitro presets. `Link` headers on the 200 response remain — CDNs convert them to 103 automatically at the edge.

### Diagnostic Steps That Worked

1. **`Server-Timing` header** — added `total;dur=N` to production responses, proving the origin rendered in 70-500ms while total request time was 5-6s. This immediately ruled out application-level issues.

2. **`curl --trace-time`** — traced the exact gap between `103 Early Hints` and `200 OK` response headers, showing the stall was between the two.

3. **Direct pod testing via `kubectl exec`** — `wget` from inside the pod showed `HTTP/1.1 103 Early Hints` being sent, while Next.js sent a clean `HTTP/1.1 200 OK`.

4. **nginx config inspection** — `nginx -T` revealed `proxy_connect_timeout 5s` and `proxy_next_upstream error timeout` — matching the observed stall duration exactly.

### Lesson

Never send HTTP informational responses (1xx) to upstream connections unless the proxy explicitly supports them. On the modern web, 103 Early Hints should be handled at the CDN edge (Cloudflare, Fastly) via `Link` headers on the final response, not by the application server. This is what Next.js does.

## Benchmarking Methodology

### Tools

| Tool                   | Purpose                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `hyperfine`            | Statistical comparison of two commands (mean, σ, min/max). Use `--warmup 3 --runs 20` minimum.  |
| `hey`                  | HTTP load testing with concurrency. Use for throughput and latency distribution under load.     |
| `curl --trace-time`    | Precise timing of each phase (DNS, TLS, TTFB, streaming). Use to diagnose where time is spent.  |
| `curl -w` format       | Quick TTFB/total measurements. Use `%{time_starttransfer}` for TTFB, `%{time_total}` for total. |
| `kubectl top pod`      | CPU/memory usage during load tests. Sample before, during, and after.                           |
| `Server-Timing` header | Origin-side timing visible in browser DevTools. Always deploy to production.                    |

### What to Measure

1. **Full page load (HTML)** — `curl -s -o /dev/null -w '%{time_total}'`. Measures origin render + CDN processing + network transfer.

2. **RSC navigation payload** — same URL with `Accept: text/x-component`. Measures data-only render without SSR overhead.

3. **Origin render time** — `Server-Timing: total;dur=N` header. Isolates application time from network/CDN time.

4. **Latency distribution under load** — `hey -n 100 -c 10`. Look at p50/p90/p99, not just averages. Tight distribution matters more than raw speed.

5. **Payload sizes** — compare uncompressed and compressed (br) sizes for HTML, RSC payloads, and JS bundles.

### What to Watch For

- **Bimodal latency** — if you see two clusters (e.g., 200ms and 5s), something is failing and retrying. Check proxies, DNS, connection pooling.
- **High variance** — σ > 50% of mean indicates an intermittent issue, not normal variance. Investigate the slow tail.
- **Origin vs total mismatch** — if `Server-Timing` shows 200ms but total is 2s, the problem is between origin and client (proxy, CDN, compression).
- **CPU/memory baseline** — measure at idle, not just under load. High idle usage indicates background work (GC, polling, etc.).

### Controlling Variables

- Always warm caches before measuring (`--warmup` in hyperfine, or manual requests).
- Test the same routes on both apps — different data volumes skew results.
- Run tests from the same network location to control for CDN edge selection.
- Note pod count — timber on 1 pod vs Next.js on 2 pods is not a fair throughput comparison.
- Avoid testing during real user traffic on one app but not the other.

## Ongoing Evaluation

### Before Cutting Over Production Traffic

1. **Match pod count** — scale timber to 2 pods to match Next.js before comparing under real load.
2. **Profile the homepage** — `/` is the only route where Next.js consistently wins. Investigate cache warming and data fetch patterns.
3. **Load test at production scale** — use `hey -n 1000 -c 50` and monitor pod CPU/memory throughout.
4. **Test client navigation** — RSC payload requests, not just full page loads. Measure time from link click to paint.
5. **Core Web Vitals** — run Lighthouse or web-vitals on both. LCP, FID/INP, CLS matter more than server timing for user experience.

### After Cutting Over

1. **Monitor `Server-Timing` p99** — set up alerting on the `total;dur` value exceeding a threshold (e.g., 2s).
2. **Track slow request logs** — the pipeline logs `concurrency` with each request. Correlate slow requests with high concurrency to detect capacity limits.
3. **Compare Real User Monitoring** — if you have RUM (e.g., Datadog, Vercel Analytics), compare timber vs Next.js on the same metrics.
4. **Watch memory growth** — timber uses 361MB vs Next.js's 4GB. Monitor for leaks over days/weeks.
