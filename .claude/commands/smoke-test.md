Run smoke tests against deployed timber.js examples.

If $ARGUMENTS contains "preview pr-N", test PR preview URLs. If "production", test production URLs. If a URL, test that directly.

## Endpoint catalogue

### Core HTTP semantics (timber's primary guarantee)
| Path | Expected |
|------|----------|
| `/` | 200 |
| nonexistent path | 404 |
| `/500-test` (if exists) | 500 |
| `/redirect-test` (if exists) | 3xx + Location header |

**Critical:** 200 on a path that should be 404/500 is a P0 finding.

### Routing correctness
| Path | Expected |
|------|----------|
| `/path%2fwith%2fslashes` | 400 (encoded separator rejection) |
| `/path%00null` | 400 (null byte rejection) |
| API route with unsupported method | 405 |

### Security
| Test | Expected |
|------|----------|
| POST without Origin header | 403 (CSRF rejected) |
| POST with oversized body | 413 or 400 |

## Workflow

1. Determine base URL (from PR deployments, production config, or direct URL)
2. For each test:
   ```bash
   curl -s -o /tmp/smoke-response -w "%{http_code} %{time_total}" -H "Accept: text/html" "<url><path>"
   ```
3. File lb issues for failures:
   - **P0**: HTTP semantic violation (200 on error page) or auth bypass
   - **P1**: Encoded separator/null byte not rejected, CSRF accepted
   - **P2**: Cache headers wrong
   - **P3**: TTFB > 2s

4. Post PR comment with results (if PR mode)
