# Next.js Test Triage & Feature Parity

## The Problem

The full Next.js `test/e2e/app-dir/` suite contains **~365 test directories** with thousands of individual test cases. We need to systematically evaluate which of these test behaviors timber.js should support, which it intentionally diverges from, and which are irrelevant.

This document lays out the plan to systematically triage every Next.js test directory, implement needed features, and establish clear boundaries for where timber.js intentionally diverges from Next.js behavior.

---

## Current State

### What We Have

| Category                 | Count              | Description                                                              |
| ------------------------ | ------------------ | ------------------------------------------------------------------------ |
| Vitest HTTP/SSR tests    | 362 pass, 6 skip   | Server-side rendering, route handlers, metadata, cookies, etc.           |
| Playwright browser tests | 38 pass, 5 skip    | Client-side navigation, hydration, error boundaries, actions             |
| Unit tests (Phase 5)     | 230 pass           | Shims (next/link, next/image, next/head, etc.), route sorting, ISR cache |
| N/A (build-only/covered) | 188+               | Tests for webpack artifacts, HMR, or already covered by existing tests   |
| **Total ported**         | **~35 test files** | Out of ~365 Next.js test directories                                     |

### What's Skipped (Known Bugs)

11 tests are skipped with documented root causes:

1. **RSC module caching** — `Date.now()` cached in dev mode; module instances persist across requests (`app-dev-server.ts`)
2. **Duplicate `<title>` with Suspense layout** — metadata emitted twice when layout wraps children in `<Suspense>`
3. **External redirect in server actions** — `redirect('https://...')` does client-side RSC nav instead of `window.location.href`
4. **Client-side hooks** — 3 Playwright tests for hook edge cases
5. **Navigation skip** — 1 Playwright test for client-side `notFound()` timing

### What's Broken (Not Tested Because It Doesn't Work)

These features are either not implemented or fundamentally incomplete. They weren't ported because there was nothing to validate:

**Parallel Routing** — The `@slot` directory convention works for basic SSR rendering. The existing 13 tests prove that slots are discovered, rendered in layouts, and produce correct HTML. But the feature is broadly broken beyond that:

- Client-side navigation between pages with different active slots
- `default.tsx` fallback rendering when a slot doesn't match the current URL
- Conditional slot rendering (showing/hiding slots based on route)
- Nested parallel routes (slots within slots)
- Interaction between parallel routes and intercepting routes during navigation
- Slot-level loading states
- Back/forward navigation preserving slot state
- Soft navigation (keeping unmatched slots visible vs replacing with default)

**Other Known Gaps** (from TRACKING.md and code audit):

- `OPTIONS` route handler missing `Allow` header
- `NextResponse.rewrite()` status code silently dropped
- Config redirect `has`/`missing` conditions — pre-middleware request context is used for all config rules, but afterFiles/fallback rewrites should evaluate against post-middleware state. A fix exists on feature branch `james/fix-rewrite-req-ctx` (introduces `postMwReqCtx`) but is not yet merged.
- Multi-value searchParams (`?tag=a&tag=b`) returns last value instead of array (note: multi-value _headers_ like `Vary` and `Set-Cookie` were fixed in PR #291, but query param parsing is a separate issue)
- Middleware response header merging — fixed in PR #290 (headers now merged on all ~37 response paths, not just RSC/HTML). Request-side forwarding for afterFiles/fallback rewrites remains open (see above).
- `loading.tsx` fallback not shown in dev streaming
- `unstable_cache` — stale entry serving and incorrect revalidate default were fixed in PR #294. The separate RSC module caching issue (Date.now() stale in dev) remains open.
- `next/font/local` variable mode (className works, CSS variables don't)

---

## Triage Methodology

### Step 1: Enumerate All Next.js Test Directories

Pull the full list of directories under `next.js/test/e2e/app-dir/`. Each directory is one "test suite" covering a specific feature or behavior. There are approximately 365 of these.

### Step 2: Categorize Each Directory

Every directory gets one of four labels:

| Label               | Meaning                                                                                                              | Action                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Port**            | timber.js implements this feature. Tests should pass.                                                                | Write compat tests, fix failures.                               |
| **Partial**         | Feature partially works. Some tests will pass, others expose real bugs.                                              | Port what passes, file issues for failures, track in skip list. |
| **N/A**             | Tests are for webpack internals, build artifacts, HMR, Edge Runtime specifics, or Next.js-only infrastructure.       | Skip permanently. Document why.                                 |
| **Won't Implement** | Feature exists in Next.js but is intentionally excluded from timber.js (e.g., PPR, AMP, `experimental.typedRoutes`). | Skip permanently. Document the decision.                        |

### Step 3: Priority Ordering

Within "Port" and "Partial", order by:

1. **User-facing breakage** — Features that real apps use and that are broken (parallel routing, intercepting routes)
2. **Confidence gap** — Features timber.js claims to support but has zero test coverage for
3. **Ecosystem compatibility** — Features required by popular libraries (next-intl, next-auth patterns, etc.)
4. **Correctness** — Subtle behavioral differences that could cause silent bugs

### Step 4: Batch Execution

Work in batches of ~10 test directories. For each batch:

1. Read the Next.js test source and fixtures
2. Determine which assertions are testable in timber.js's architecture (Vitest SSR vs Playwright)
3. Port the test, adapting fixtures to timber.js's test structure (`tests/fixtures/app-basic/app/nextjs-compat/`)
4. Run the tests. Passing tests get added to TRACKING.md. Failing tests get root-caused and either fixed immediately or filed as issues with fix locations.

---

## Feature Fix Priorities

### Tier 1: Parallel Routing (Major)

Parallel routing is the single largest broken feature. It requires fixes across the routing layer, the rendering pipeline, and the client-side navigation system.

**What needs to work:**

1. **Slot discovery and SSR rendering** — Already works. `@slot` directories are discovered by `app-router.ts`, rendered in layout components, and produce correct HTML.

2. **`default.tsx` fallback** — When navigating to a URL that doesn't match a slot's routes, the slot should render its `default.tsx` (or the nearest ancestor's `default.tsx`). The routing layer (`app-router.ts`) correctly discovers `default.tsx` files and creates synthetic routes with `defaultPath`, but the client-side rendering doesn't use `default` when `page` is null during navigation.

3. **Client-side slot navigation** — Navigating between pages that have different slot contents should update only the changed slots while preserving the others. This requires the RSC payload to include per-slot diffs, not just a full page re-render.

4. **Soft vs hard navigation** — On soft navigation (Link click), unmatched slots should keep their current content. On hard navigation (URL bar, refresh), unmatched slots should render `default.tsx`. This distinction is fundamental to how parallel routing works.

5. **Intercepting routes within parallel slots** — The `(.)`, `(..)`, `(...)` conventions should work inside `@slot` directories for modal patterns (e.g., `feed/@modal/(.)photo/[id]`).

6. **Nested parallel routes** — Slots within slots. A layout with `@sidebar` where the sidebar itself has `@tabs`.

7. **Loading states per slot** — Each slot should independently show its `loading.tsx` during navigation.

**Implementation approach:**

The routing layer already has much of the plumbing:

- `app-router.ts` discovers `@slot` directories, resolves `defaultPath` for each `ParallelSlot`, and creates synthetic routes for non-matching slots using parent's `default.tsx`
- `app-dev-server.ts` generates virtual RSC entries that include both `page` and `default` for each slot (lines 114-119)

What's missing is the runtime behavior:

- The browser entry (`app-dev-server.ts` line 2932+) needs to use `default` when `page` is null during client-side RSC navigation
- Per-slot diffs in the RSC response so the client can update only changed slots
- Soft vs hard navigation distinction (keep old slot content on Link click, use default.tsx on refresh/URL bar)

### Tier 2: Fix Existing Skip List

These are known bugs with documented fix locations. Each is a targeted fix:

| Issue                                                            | Fix Location                                                                            | Effort |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| RSC module caching                                               | `app-dev-server.ts` — invalidate module cache per request                               | Medium |
| Duplicate `<title>` with Suspense                                | `app-dev-server.ts:buildPageElement()` — hoist metadata above Suspense                  | Low    |
| External redirect in actions                                     | Browser entry — detect external origin, use `window.location.href`                      | Low    |
| `OPTIONS` + `Allow` header                                       | Route handler logic                                                                     | Low    |
| `NextResponse.rewrite()` status                                  | Routing/rewrite handler — thread status through response                                | Medium |
| Config redirect `has`/`missing` for afterFiles/fallback rewrites | Feature branch `james/fix-rewrite-req-ctx` — use `postMwReqCtx` for afterFiles/fallback | Medium |
| Multi-value searchParams                                         | Query param parsing — use `getAll()`                                                    | Low    |
| Middleware request headers for afterFiles rewrites               | Same feature branch — maintain two request context snapshots (pre/post middleware)      | Medium |

### Tier 3: Missing Feature Implementation

Features that real apps need but are not yet implemented or are incomplete:

1. **`next/font/local` CSS variables** — The `className` approach works but `variable` mode (which sets CSS custom properties) doesn't. Many Tailwind setups use variable mode.
2. **Partial Pre-Rendering (PPR)** — Experimental in Next.js but increasingly adopted. timber.js has a different philosophy here (see Divergence section).

### Tier 4: Expanded Test Coverage

After fixing broken features, systematically port tests from the remaining ~330 Next.js directories. Expected distribution based on initial audit:

| Category        | Estimated Count | Examples                                                                      |
| --------------- | --------------- | ----------------------------------------------------------------------------- |
| Port            | ~80-100         | Route groups, catch-all, dynamic params, i18n, middleware patterns            |
| Partial         | ~40-60          | Parallel routes, intercepting routes, advanced metadata, turbopack-specific   |
| N/A             | ~120-150        | Webpack config, `.next/` build output, Edge Runtime, HMR, Turbopack internals |
| Won't Implement | ~30-40          | AMP, PPR (for timber.js), `experimental.typedRoutes`, Pages Router migration  |

---

## Next.js vs Timber.js Divergence

Some Next.js behaviors are intentionally different in timber.js. The test triage must account for this — tests that validate Next.js-specific behavior that timber.js rejects should be marked as "Won't Implement (timber.js divergence)".

### Where timber.js diverges

| Next.js Behavior                                                 | timber.js Behavior                                              | Rationale                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| All responses start as HTTP 200 (streaming commits status early) | Status code set after shell renders; correct 404/302/401/403    | Correct HTTP semantics (see `01-philosophy.md`)            |
| `loading.tsx` at every segment level                             | No `loading.tsx`; `<Suspense>` is opt-in at sub-page level only | Streaming only where explicitly requested; no layout shift |
| Aggressive fetch caching (`force-cache` default)                 | No implicit caching; `timber.cache` is explicit                 | Predictable behavior over implicit optimization            |
| `middleware.ts` runs on Edge, limited API                        | `proxy.ts` + `middleware.ts` with full server API               | Real middleware with full Node.js access                   |
| `next/font` self-hosts fonts                                     | CDN-based font loading (Google Fonts CDN)                       | Simpler, no build-time font processing                     |
| Client-side router cache (30s/5min defaults)                     | No client router cache by default                               | Fresh data on every navigation                             |

### Implications for testing

- **Next.js compat tests** verify that timber.js matches Next.js behavior where compatibility is intended.
- **Timber.js divergence tests** explicitly verify timber.js's intentional differences. For example, a timber.js test for `loading.tsx` would verify that it does NOT auto-stream, while a Next.js compat test would verify that standard rendering works.

---

## Test Infrastructure

### Current Structure

```
tests/
  nextjs-compat/          # Vitest HTTP/SSR tests (ported from Next.js)
    TRACKING.md           # Central tracking document
    app-rendering.test.ts
    not-found.test.ts
    ...
  e2e/app-router/
    nextjs-compat/        # Playwright browser tests
      dynamic.spec.ts
      metadata.spec.ts
      ...
  fixtures/app-basic/     # Shared fixtures
    app/nextjs-compat/    # Fixtures for compat tests
    app/dashboard/        # Pre-existing parallel routing fixtures
  *.test.ts               # Unit tests (link, image, head, etc.)
```

### Scaling the Test Suite

As we port hundreds more tests, the current flat structure needs minor organization:

1. **Keep TRACKING.md as the source of truth** — Every ported test directory gets an entry with its status, skip reasons, and fix locations.
2. **Group fixtures by feature area** — `fixtures/app-basic/app/nextjs-compat/parallel-routes/`, `fixtures/app-basic/app/nextjs-compat/intercepting/`, etc.
3. **Playwright specs per feature** — `tests/e2e/app-router/nextjs-compat/parallel-routes.spec.ts` rather than cramming everything into existing files.
4. **CI runtime** — Monitor CI duration as test count grows. The current Vitest suite runs fast (HTTP-level, no browser). Playwright is slower but parallelized across 5 projects. May need to split Playwright into sharded runs if we exceed ~100 specs.

---

## Success Criteria

### Phase 1: Triage Complete

- Every Next.js `test/e2e/app-dir/` directory has been categorized (Port / Partial / N/A / Won't Implement)
- Categories are documented in TRACKING.md or a companion triage document
- Priority ordering is established

### Phase 2: Parallel Routing Fixed

- All Next.js parallel routing tests that are categorized as "Port" pass
- Client-side navigation, `default.tsx`, soft/hard navigation distinction all work
- Playwright tests cover the full parallel routing lifecycle

### Phase 3: Skip List Cleared

- All 11 currently skipped tests pass (or are reclassified with justification)
- Known bugs from the fix backlog are resolved

### Phase 4: Coverage Target

- **80%+ of "Port" directories** have passing tests
- **All "Partial" directories** have their passing subset ported and failures tracked
- Total passing test count reaches **1000+** (up from current ~400)
- Every broken test has a root-cause analysis and fix location documented

### Phase 5: Timber.js Fork

- Timber.js test suite established with shared infrastructure
- Divergence points have explicit tests proving timber.js's intentional differences
- All test suites (compat + divergence) run in CI

---

## Appendix: Known Feature Support Matrix

Based on code audit and Next.js feature comparison:

| Feature                                   | Status          | Broken/Missing Aspects                                                                                                                   |
| ----------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| App Router (pages, layouts, route groups) | Full            | —                                                                                                                                        |
| Parallel routes (`@slot`)                 | Partial         | Routing layer discovers slots and defaults correctly. Client nav, soft/hard nav distinction, and slot-level updates are not implemented. |
| Intercepting routes (`(.)`, `(..)`)       | Partial         | Interaction with parallel slots during nav                                                                                               |
| Server Components                         | Full            | —                                                                                                                                        |
| Client Components                         | Full            | —                                                                                                                                        |
| Server Actions                            | Full            | External redirect handling                                                                                                               |
| Route Handlers                            | Full            | OPTIONS/Allow header                                                                                                                     |
| Middleware                                | Full            | Response headers fixed (PR #290). Request-side forwarding for afterFiles/fallback rewrites pending (branch `james/fix-rewrite-req-ctx`). |
| Metadata (static + dynamic)               | Full            | Duplicate title with Suspense layout. Default viewport meta fixed (PR #298).                                                             |
| Streaming / Suspense                      | Full            | loading.tsx not visible in dev                                                                                                           |
| ISR / Revalidation                        | Full            | `unstable_cache` stale entries fixed (PR #294). RSC module caching in dev still open.                                                    |
| next/link                                 | Full            | —                                                                                                                                        |
| next/image                                | Partial         | Uses @unpic/react, no local optimization                                                                                                 |
| next/dynamic                              | Full            | —                                                                                                                                        |
| next/font/google                          | Partial         | CDN-based, not self-hosted                                                                                                               |
| next/font/local                           | Partial         | className works, variable mode broken                                                                                                    |
| next/head                                 | Full            | —                                                                                                                                        |
| next/script                               | Full            | —                                                                                                                                        |
| next/form                                 | Full            | —                                                                                                                                        |
| Draft Mode                                | Full            | —                                                                                                                                        |
| CSS Modules                               | Full (via Vite) | —                                                                                                                                        |
| i18n (path prefix)                        | Full            | Domain-based routing not supported                                                                                                       |
| `useServerInsertedHTML`                   | Full            | Implemented in `shims/navigation.ts`, integrated in SSR. `check.ts` needs update.                                                        |
| PPR                                       | Missing         | Intentionally excluded from timber.js                                                                                                    |
| AMP                                       | Stub            | Returns false, won't implement                                                                                                           |

---

## Timber.js Feature Testing

Beyond Next.js compatibility tests, timber.js introduces novel features that need their own test suites. These are not ported from Next.js — they validate timber.js-specific behavior.

### Test Areas

| Feature                     | Test Focus                                                                                                                                                                                                                                | Test Type                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `access.ts` / `AccessGate`  | Auth gate runs on every navigation, shallowest failure wins, return values discarded, shared `React.cache` scope                                                                                                                          | Vitest HTTP + Playwright |
| `middleware.ts` (per-route) | Pre-render blocking, short-circuit responses, request header injection, lightweight auth, cache warming via `timber.cache`, leaf-only execution                                                                                           | Vitest HTTP              |
| `proxy.ts`                  | Runs before route matching, `next()` wrapping, array form, covers all endpoints including RSC payloads                                                                                                                                    | Vitest HTTP              |
| `denied.tsx`                | Slot access denial renders `denied.tsx`, fallback to `default.tsx`, fallback to null                                                                                                                                                      | Vitest HTTP + Playwright |
| `deny()`                    | Universal denial: correct HTTP status in segments (default 403, `deny(404)`, `deny(401)`), graceful degradation in slots, `denied.tsx` rendered, degraded behavior in post-flush Suspense, dev-mode error for `redirect()` in slot access | Vitest HTTP              |
| `deferSuspenseFor`          | Inline rendering when Suspense resolves before deadline, fallback when deadline expires                                                                                                                                                   | Vitest HTTP + Playwright |
| `timber.cache`              | TTL expiry, tag invalidation, key determinism, cache handler pluggability, separation from `React.cache`                                                                                                                                  | Unit tests               |
| Flush point                 | Status code commits at `onShellReady`, correct 404/302/401/403 from components and access.ts                                                                                                                                              | Vitest HTTP              |
| `searchParams()`            | ALS-backed, auto-parsed in pages/handlers/access, raw in nested components                                                                                                                                                                | Vitest HTTP              |
| `route.ts` API endpoints    | Method routing, 405 for unsupported methods, `OPTIONS` auto-response, `proxy.ts` + `middleware.ts` + `access.ts` integration                                                                                                              | Vitest HTTP              |
| URL canonicalization        | Single decode, encoded separator rejection, null byte rejection, path normalization                                                                                                                                                       | Vitest HTTP              |
| Segment tree diffing        | Sync layouts skipped, async layouts re-rendered, pages always re-rendered, access always runs                                                                                                                                             | Playwright               |
| Layout state preservation   | Client state preserved across navigations via React Flight reconciliation, unmount on layout group change                                                                                                                                 | Playwright               |

### Infrastructure

Timber.js-specific tests should use the same infrastructure as compat tests (Vitest HTTP for server-side, Playwright for client-side) but live in a separate directory:

```
tests/
  timber/                    # Timber.js-specific tests
    access-gate.test.ts
    handler.test.ts
    proxy.test.ts
    flush-point.test.ts
    forbidden.test.ts
    deferred-suspense.test.ts
    ...
  e2e/
    timber/                  # Playwright tests for timber.js features
      layout-shell.spec.ts
      navigation.spec.ts
      ...
  fixtures/
    timber/                  # Fixtures for timber.js tests
      app/
        ...
```
