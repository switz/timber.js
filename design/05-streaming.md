# Streaming

## The Rule

The framework never inserts `<Suspense>` boundaries. The framework never removes `<Suspense>` boundaries. Streaming happens exactly where the developer places it.

Third-party components that use Suspense internally work fine. The framework does not interfere.

## The Status Code Contract

Anything outside a `<Suspense>` boundary can affect the status code. Anything inside a regular `<Suspense>` boundary cannot — the status is committed before inside-Suspense content resolves.

Wrapping content in a `<Suspense>` boundary is a declaration that nothing inside it needs to affect the status code. A login/dashboard button in a header, a list of reviews, a feed of tweets — none of these change whether the page is a 200 or 404. That's why they belong inside a boundary.

`deny()` called inside a Suspense boundary will not reliably produce the correct HTTP status code — the status may already be committed. In this case, `deny()` triggers the nearest error boundary and injects a `<meta name="robots" content="noindex">` tag into the page. The page returns 200. The framework warns in dev mode when this is detected.

`redirect()` called inside a Suspense boundary performs a client-side redirect. The HTTP status is already 200, so the framework cannot send a 3xx — instead it emits a client-side navigation to the target URL. Dev-mode warning is emitted.

## The Layout Suspense Footgun

```tsx
// ⚠️ dashboard/layout.tsx — common mistake
export default function Layout({ children }) {
  return (
    <DashboardShell>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </DashboardShell>
  );
}
```

This makes every page under `/dashboard` stream. The status code commits before any page content resolves. `deny(404)` inside any of those pages will trigger the nearest error boundary and inject a `noindex` robots metatag — but the HTTP status will be 200. `redirect()` inside any of those pages will perform a client-side navigation rather than a proper HTTP 3xx. The developer almost certainly intended to show a loading state during navigation, not to surrender HTTP correctness for every page in the segment.

The framework warns in dev mode when a `<Suspense>` directly wraps the children/page slot in a layout.

The correct pattern for navigation loading state is the framework-provided `useNavigationPending()` hook, which signals whether a transition is in flight without wrapping the page in Suspense.

---

## `deferSuspenseFor` — Holding the SSR Stream

By default, Suspense boundaries stream after the status commits — the fallback is sent immediately and the content streams in when ready. `deferSuspenseFor` tells the server: **wait up to N milliseconds before reading the HTML stream, giving fast-resolving Suspense boundaries time to resolve inline.** If all boundaries resolve within the deadline, their content renders inline — no skeleton, no spinner, no layout shift. If the deadline expires, remaining fallbacks flush and content streams in later.

This is the "it's okay to wait a bit before flushing, but if it goes too long just flush and we'll stream" primitive.

```tsx
import { Suspense } from 'react';

// Hold the SSR stream for up to 200ms. Fast-resolving Suspense
// boundaries render inline without ever showing a fallback.
export const deferSuspenseFor = 200;

export default async function ProductPage({ params }) {
  const product = await getProduct(params.id);
  if (!product) deny(404);

  return (
    <div>
      <ProductHeader product={product} />
      <Suspense fallback={<ReviewsSkeleton />}>
        <ProductReviews productId={product.id} />
      </Suspense>
    </div>
  );
}
```

If `<ProductReviews>` resolves within 200ms, the reviews render inline — no fallback ever emitted in the HTML. If it takes longer than 200ms, the fallback flushes and reviews stream in when ready.

### How It Works

`deferSuspenseFor` operates at the SSR level, not in the React component tree. React's `renderToReadableStream` generates HTML **lazily on pull** — if we delay reading the stream, React has time to resolve pending Suspense boundaries and inline their content instead of serializing fallbacks.

The implementation in `ssr-render.ts`:

```ts
// Race allReady against the deferSuspenseFor timeout
const deferMs = options?.deferSuspenseFor;
if (deferMs && deferMs > 0) {
  await Promise.race([
    stream.allReady,
    new Promise<void>((resolve) => setTimeout(resolve, deferMs)),
  ]);
}
```

The `Promise.race` ensures we don't wait longer than necessary — if all Suspense boundaries resolve before the timeout, the stream flushes immediately with all content inlined. If the timeout expires first, we start reading and any unresolved boundaries flush their fallbacks.

```
Timeline — reviews resolve at 80ms, deferSuspenseFor=200:

t=0ms   → renderToReadableStream resolves (shell ready)
          Start hold: race allReady vs 200ms timeout
t=80ms  → Reviews resolve → allReady resolves
          Hold ends early (allReady won the race)
          First read: reviews inlined in HTML, no fallback ✓

Timeline — reviews resolve at 500ms, deferSuspenseFor=200:

t=0ms   → renderToReadableStream resolves (shell ready)
          Start hold: race allReady vs 200ms timeout
t=200ms → Timeout fires, hold ends (allReady still pending)
          First read: fallback in HTML, reviews still pending
t=500ms → Reviews resolve
          React streams replacement content ✓
```

### The Export Convention

`deferSuspenseFor` is a **page-level or layout-level export**, like `metadata`. The framework collects it during module loading (before rendering) and takes the **maximum** across all segments in the route chain. It's passed from the RSC environment to SSR via `NavContext.deferSuspenseFor`.

```tsx
// page.tsx
export const deferSuspenseFor = 200; // ms
```

Layouts can also export it — the framework uses the max value from all loaded modules.

### Rules

- `deferSuspenseFor` is in milliseconds. No string durations.
- If all boundaries resolve before the deadline, the stream flushes immediately — it does not wait for the remaining time.
- `deferSuspenseFor = 0` (or omitting the export) means no hold — standard streaming behavior.
- Users write plain `<Suspense>` boundaries. The hold is invisible to the component tree.
- **SSR only (for now).** `deferSuspenseFor` delays the first read of the HTML stream on the server. On client-side navigation, React renders new Suspense boundaries immediately — fallbacks show while content resolves. A future enhancement may use `startTransition` or a custom mechanism to defer fallbacks during client navigation, but this requires solving the "new boundary has no old content" problem (React can only defer reveals for boundaries that already have committed content).

### When to Use `deferSuspenseFor`

- A secondary data fetch is usually fast (< 200ms) and you'd rather wait than flash a skeleton.
- You want to avoid layout shift from a spinner that appears for 50ms then disappears.
- A slow DB query _might_ be fast — give it a grace period, but don't block the page on it.

### When Not to Use `deferSuspenseFor`

- The content needs to affect the status code. Fetch it outside any Suspense boundary.
- All content is known to be slow (> 1s). Just let the fallback show immediately.
- You're wrapping `{children}` in a layout. Use `useNavigationPending()` instead.

### `deferSuspenseFor` and the Hold Window

`deferSuspenseFor` extends the hold window. The hold window is defined by whether the HTTP status has committed, not by component structure. If the status has not committed yet and a signal (`deny()`, `redirect()`, etc.) is thrown inside a Suspense boundary during the hold, the signal is promoted to pre-flush semantics — the framework can still send the correct HTTP status code.

The contract remains: **do not rely on Suspense-wrapped content to affect the status code.** If content must drive the status code, fetch it outside any boundary.
