# Client Navigation

## Architecture Overview

Client-side navigation in timber.js is inspired by Next.js's segment router. The client maintains a segment cache, fetches RSC payloads for new routes, and reconciles the React tree without a full page reload.

The system has four key components:

1. **Segment Router** — manages the mounted segment tree and composes RSC payloads
2. **RSC Payload Handler** — fetches, parses, and caches RSC flight payloads
3. **History Stack** — stores payloads by URL for instant back/forward navigation
4. **Prefetch Cache** — short-lived cache for hover-triggered prefetches

---

## Segment Router

The segment router is the core of client navigation. It maintains a tree representing the currently mounted segments (layouts + page) and their RSC payloads.

### Segment Tree Structure

```
Root Layout ─── Dashboard Layout ─── Projects Layout ─── Project Page
     │                  │
     │                  └── @sidebar slot
     └── @modal slot
```

Each node in the tree stores:

- The segment's RSC flight payload (serialized React subtree)
- Whether the segment is sync or async (determines skip behavior on navigation)
- Slot children (parallel routes)
- The segment's URL pattern (e.g., `/dashboard/projects/[id]`)

### Navigation Reconciliation

On navigation, the router diffs the new route's segment chain against the mounted tree:

1. Walk from root to leaf, comparing new segments with mounted segments
2. **Matching sync layout** — reuse cached payload (layout is already mounted, state preserved)
3. **Matching async layout** — always re-fetch (async layouts may depend on request context)
4. **Different segment** — fetch new payload, unmount old segment and all children
5. **Page** — always re-fetch (pages are never cached across navigations)

This diffing is what makes layout state preservation work. A sync layout stays mounted across navigations within its segment group — React reconciles the component identity, preserving client component state, scroll position, and DOM state.

---

## Navigation Flow

### Link Click → Render

```
1. User clicks <Link href="/projects/123">
2. Router serializes current segment tree → X-Timber-State-Tree header
3. React transition starts (useNavigationPending() returns true)
4. Fetch RSC payload: GET /projects/123 with Accept: text/x-component
5. Server receives request:
   a. Runs proxy.ts
   b. Matches route
   c. Runs middleware.ts
   d. Runs access.ts gates (ALL of them, regardless of state tree)
   e. Renders React tree, skipping sync layouts listed in state tree
   f. Returns partial RSC payload (skipped segments absent)
6. Client receives RSC stream
7. Router diffs payload against mounted tree
8. React reconciles: new segments mount, unchanged layouts stay
9. Scroll to top (forward navigation)
10. React transition ends (useNavigationPending() returns false)
```

### `X-Timber-State-Tree` Header

The client sends a serialized representation of its mounted segment tree on every navigation request. This is a **performance optimization only** — it tells the server which sync layouts the client already has, so the server can skip re-rendering them.

The header is NOT a security boundary. The server always runs all `access.ts` files regardless of the state tree content. A fabricated state tree can only cause extra rendering work or stale layouts — never auth bypass.

Format: JSON-encoded tree of segment paths:

```json
{ "segments": ["/", "/(auth)/dashboard", "/projects"] }
```

### `router.refresh()`

Explicit full re-render. No state tree is sent — the server renders the complete RSC payload for every segment. Use after mutations that affect data in parent layouts.

---

## RSC Payload Handling

### Fetch

Navigation requests use `fetch()` with a `?_rsc=<id>` cache-bust parameter (5-char random a-z0-9, matching Next.js) appended to the URL. This follows Next.js's pattern — it prevents CDNs and the browser cache from serving cached HTML for RSC requests, and signals to intermediaries that this is an RSC fetch.

Headers:

- `Accept: text/x-component` — signals RSC payload request (not HTML)
- `X-Timber-State-Tree: ...` — mounted segment tree for layout skip optimization
- Standard cookies and auth headers — the request goes through the full pipeline

The server responds with `Vary: Accept` to ensure CDNs cache HTML and RSC responses separately for the same URL.

### Parse

The RSC flight payload is a streaming format. The client uses React's `createFromFetch()` to parse the stream into a React element tree as chunks arrive. Parsing is progressive — the router can begin reconciliation before the full payload has arrived.

### Cache

Parsed payloads are stored in the segment tree. Each segment's payload is cached independently, enabling partial updates on subsequent navigations.

### Partial vs Full Payloads

**Full payload** — contains all segments from root to page. Sent on:

- Initial page load (SSR HTML + RSC payload for hydration)
- `router.refresh()`
- Navigation when the server decides the state tree is stale

**Partial payload** — skipped segments are simply absent. The client uses its cached segments for the missing entries. Sent on:

- Standard navigation when sync layouts match the state tree

The wire format is identical — partial payloads are just full payloads with some segments missing. The client detects which segments are present and fills in cached data for the rest.

---

## History Stack

RSC payloads are stored by `(url, scrollY)` in a session-lived history stack. This enables instant back/forward navigation without a server roundtrip.

### Initial Page Entry

On bootstrap, the initial SSR'd page is stored in the history stack with the decoded RSC element (from `createFromReadableStream` of the inlined RSC payload). This means back navigation to the initial page replays the cached element instantly — no server roundtrip required. If no RSC payload is available (e.g., JS-only client), the entry stores `null` and back navigation fetches from the server.

### Storage

```
History Stack:
  /                   scrollY=0    → [Initial RSC element from hydration]
  /dashboard          scrollY=0    → [RSC payload from navigation fetch]
  /projects           scrollY=200  → [RSC payload from navigation fetch]
  /projects/123       scrollY=0    → [RSC payload from navigation fetch]
```

Each entry stores the complete segment tree payload at the time of navigation. When the user navigates forward, the current page's payload (with scroll position) is pushed onto the stack.

### Replay

On `popstate` (back/forward button):

1. Look up the URL in the history stack
2. If found: replay the cached payload instantly — no server request
3. Restore `scrollY` from the stored position
4. React reconciles the cached tree (state may be stale, but navigation is instant)

### Lifetime

History stack entries persist for the session duration — no expiry. They are cleared when the tab is closed. This matches browser behavior: the back button always works within a session.

---

## Prefetch Cache

Prefetching loads RSC payloads before the user clicks, enabling near-instant navigation.

### Trigger

Prefetching is opt-in via `<Link prefetch>`:

```tsx
<Link href="/projects" prefetch>
  Projects
</Link>
```

When `prefetch` is set, the payload is fetched on hover (not on viewport intersection). This balances bandwidth cost against navigation speed.

### Cache Behavior

- **TTL: 30 seconds.** Prefetched entries expire after 30 seconds. Hover again to re-prefetch.
- **On navigation:** If the user clicks the link before the prefetch expires, the cached payload is used immediately. The entry moves from the prefetch cache to the history stack.
- **On expiry:** The entry is dropped. The next navigation to that URL fetches fresh.

### No Automatic Prefetching

timber.js does NOT prefetch links on viewport intersection. Only `<Link prefetch>` with an explicit hover triggers a prefetch. This is a deliberate choice — automatic prefetching wastes bandwidth for most links and creates unnecessary server load.

---

## Scroll Restoration

### afterPaint Timing

All scroll operations are deferred until after React has committed the new content to the DOM. The router uses an `afterPaint` callback (double `requestAnimationFrame` in the browser) to schedule `scrollTo` after the paint. This is necessary because:

1. `reactRoot.render()` is asynchronous — the DOM isn't updated synchronously
2. Calling `reactRoot.render(newElement)` with a new element tree causes React to reconcile the entire document, resetting scroll to 0 (see "Why Not Browser-Native Scroll Restoration?" below)
3. Calling `scrollTo` before the new content is painted has no effect (browser clamps to content height)

In unit tests, `afterPaint` falls back to synchronous execution (no rAF available).

### Forward Navigation

Scroll to top via `afterPaint(() => scrollTo(0, 0))` after React reconciliation. This is the expected behavior when navigating to a new page.

### Back/Forward Navigation

Restore saved `scrollY`. The framework sets `history.scrollRestoration = 'manual'` and manages scroll position explicitly:

1. On push (forward navigation): save `window.scrollY` with the current history entry via `lastKnownUrl`
2. On popstate (back/forward): save the departing page's scroll using `lastKnownUrl`, replay cached payload, then `afterPaint(() => scrollTo(0, savedScrollY))`

**Why `lastKnownUrl`:** By the time the `popstate` event fires, `window.location.href` has already changed to the target URL. The router tracks the URL the user is currently viewing in `lastKnownUrl` so it can save the correct page's scroll position before processing the navigation.

**URL normalization:** History stack keys use `pathname + search` (not full `href`) to match between `navigate()` (which receives relative URLs from links) and `handlePopState()` (which reads from `window.location`). This normalization happens at the browser-entry boundary.

### Opt-Out: `scroll={false}`

`<Link scroll={false}>` preserves the current scroll position during forward navigation. When the user clicks a `scroll={false}` link:

1. The current `scrollY` is captured before the fetch
2. After `renderPayload()`, `afterPaint` restores the captured scroll position

This active restoration is required because timber calls `reactRoot.render(newElement)` with a new element tree on each navigation, causing React to reconcile the entire document and reset scroll to 0. The scroll position cannot be passively preserved — it must be explicitly saved and restored.

### Why Not Browser-Native Scroll Restoration?

Next.js App Router uses `history.scrollRestoration = 'auto'` and browser-native scroll restoration works there. Both Next.js and timber render to the `document` root via `hydrateRoot(document, ...)` — the difference is **how navigations are rendered**:

- **Next.js App Router**: Holds the RSC cache in React state inside a persistent `<AppRouter>` component. Navigation updates router state via `useReducer`, which triggers React to re-render only the changed subtree. The top-level element tree identity is preserved, so React reconciles in place without resetting scroll.
- **timber.js**: Calls `reactRoot.render(newElement)` with a completely new RSC element tree on each navigation. This replaces the entire tree, causing React to reconcile the whole document from scratch — which resets scroll to 0.

The scroll reset is not caused by rendering to `document`. It's caused by replacing the entire element tree instead of updating state within a persistent tree.

**Future improvement:** A persistent `<TimberRouter>` component that holds the current RSC payload in React state and renders it as children would let React reconcile in place, preserve scroll natively, and eliminate all the manual scroll machinery (`scrollRestoration = 'manual'`, `afterPaint`, `lastKnownUrl`, `timber:scroll-restored`).

For now, timber.js explicitly manages scroll via `history.scrollRestoration = 'manual'` + in-memory history stack.

### `timber:scroll-restored` Event

After every scroll operation (forward nav scroll-to-top, back/forward restore, scroll={false} preservation), the router dispatches a `timber:scroll-restored` event on `window`. This provides a deterministic signal for E2E tests to wait for instead of polling `window.scrollY`, which is unreliable due to the async afterPaint timing.

---

## `useNavigationPending()`

A client-side hook that returns `true` while an RSC navigation is in flight. Integrates with React transitions.

```tsx
'use client';
import { useNavigationPending } from '@timber/app/client';

export function NavBar() {
  const isPending = useNavigationPending();
  return (
    <nav className={isPending ? 'opacity-50' : ''}>
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/settings">Settings</Link>
    </nav>
  );
}
```

The pending state is true from the moment the RSC fetch starts until React reconciliation completes. This includes:

- The fetch itself (network time)
- RSC stream parsing
- React tree reconciliation

It does NOT include Suspense streaming after the shell — only the initial shell reconciliation.

---

## `useLinkStatus()`

A client-side hook that returns `{ pending: boolean }` scoped to a specific link. Unlike `useNavigationPending()` which is global, `useLinkStatus()` is true only while a navigation targeting the given `href` is in flight.

```tsx
'use client';
import { useLinkStatus } from '@timber/app/client';
import { Link } from '@timber/app/client';

export function Tab({ href, children }: { href: string; children: React.ReactNode }) {
  const { pending } = useLinkStatus(href);
  return (
    <Link href={href} className={pending ? 'opacity-50' : ''}>
      {children}
    </Link>
  );
}
```

The `href` argument must match the URL passed to `router.navigate()` exactly (pathname + search, no origin). The hook compares the given `href` against the router's pending URL — the URL of the currently in-flight navigation.

The pending state follows the same lifecycle as `useNavigationPending()`: true from when the RSC fetch starts until React reconciliation completes.

---

## Progressive Enhancement

Without JavaScript, `<Link>` renders as a plain `<a>` tag. Clicking it triggers a full page navigation — standard browser behavior. The server renders the full HTML response.

With JavaScript, `<Link>` intercepts the click, fetches an RSC payload, and reconciles the DOM. The URL updates via `history.pushState`. No full page reload.

This means every navigation path works without JavaScript. The client runtime is a progressive enhancement that makes navigation faster, not a requirement for the app to function.

---

## What Client Navigation Does NOT Do

- **Parallel route fetching.** Each navigation fetches one RSC payload. The server renders the full segment chain in one pass. There is no client-side orchestration of multiple parallel fetches.
- **Optimistic navigation.** The router does not speculatively render before the RSC payload arrives. `useNavigationPending()` provides UI feedback during the fetch.
- **Route preloading on viewport intersection.** Only hover-triggered prefetch via `<Link prefetch>`.
- **Offline support.** No service worker integration. RSC payloads are not cached in `CacheStorage`.
- **View Transitions API.** Not integrated in v1. May be added in a future phase.
