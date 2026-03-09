# Streaming

## The Rule

The framework never inserts `<Suspense>` boundaries. The framework never removes `<Suspense>` boundaries. Streaming happens exactly where the developer places it.

Third-party components that use Suspense internally work fine. The framework does not interfere.

## The Status Code Contract

Anything outside a `<Suspense>` boundary can affect the status code. Anything inside a regular `<Suspense>` boundary cannot — the status is committed before inside-Suspense content resolves.

Wrapping content in any Suspense boundary — `<Suspense>` or `<DeferredSuspense>` — is a declaration that nothing inside it needs to affect the status code. A login/dashboard button in a header, a list of reviews, a feed of tweets — none of these change whether the page is a 200 or 404. That's why they belong inside a boundary.

`<DeferredSuspense ms={ms}>` has the same contract as `<Suspense>`: content inside it does not participate in the status code decision. If the children happen to resolve before `ms` and before the status commits, they technically become part of the shell — but that's a side effect of the implementation, not the design intent. Don't rely on it for correctness. If content *must* affect the status code, fetch it outside any boundary.

`deny()` called inside a Suspense boundary (including `<DeferredSuspense>`) will not reliably produce the correct HTTP status code — the status may already be committed. In this case, `deny()` triggers the nearest error boundary and injects a `<meta name="robots" content="noindex">` tag into the page. The page returns 200. The framework warns in dev mode when this is detected.

`redirect()` called inside a Suspense boundary (including `<DeferredSuspense>`) performs a client-side redirect. The HTTP status is already 200, so the framework cannot send a 3xx — instead it emits a client-side navigation to the target URL. Dev-mode warning is emitted.

## The Layout Suspense Footgun

```tsx
// ⚠️ dashboard/layout.tsx — common mistake
export default function Layout({ children }) {
  return (
    <DashboardShell>
      <Suspense fallback={<PageSkeleton />}>
        {children}
      </Suspense>
    </DashboardShell>
  )
}
```

This makes every page under `/dashboard` stream. The status code commits before any page content resolves. `deny(404)` inside any of those pages will trigger the nearest error boundary and inject a `noindex` robots metatag — but the HTTP status will be 200. `redirect()` inside any of those pages will perform a client-side navigation rather than a proper HTTP 3xx. The developer almost certainly intended to show a loading state during navigation, not to surrender HTTP correctness for every page in the segment.

The framework warns in dev mode when a `<Suspense>` directly wraps the children/page slot in a layout.

The correct pattern for navigation loading state is the framework-provided `useNavigationPending()` hook, which signals whether a transition is in flight without wrapping the page in Suspense.

---

## `<DeferredSuspense>` — Holding the Flush Before Streaming

By default, Suspense boundaries stream after the status commits — the fallback is sent immediately and the content streams in when ready. `<DeferredSuspense>` tells the server: **wait up to `ms` milliseconds for this boundary to resolve before flushing the fallback.** If the content resolves within the deadline, it renders inline — no skeleton, no spinner, no layout shift. If the deadline expires, the fallback flushes and the content streams in later.

This is the "it's okay to wait a bit before flushing, but if it goes too long just flush and we'll stream" primitive.

```tsx
import { DeferredSuspense } from '@timber/app'

export default async function ProductPage({ params }) {
  const product = await getProduct(params.id)
  if (!product) deny(404)

  return (
    <div>
      <ProductHeader product={product} />
      <DeferredSuspense ms={200} fallback={<ReviewsSkeleton />}>
        <ProductReviews productId={product.id} />
      </DeferredSuspense>
    </div>
  )
}
```

If `<ProductReviews>` resolves within 200ms, the reviews render inline — no fallback ever shown. If it takes longer than 200ms, the fallback flushes and reviews stream in when ready.

### Implementation: Nested Suspense Boundaries

`<DeferredSuspense>` is a pure React component — no framework internals, no stream parsing. It works by composing two Suspense boundaries with a `<Delay>` component that itself suspends:

```tsx
import { Suspense, use, cache } from 'react'

const getDelay = cache((ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms))
)

function Delay({ ms, children }: { ms: number; children: React.ReactNode }) {
  use(getDelay(ms))
  return children
}

export function DeferredSuspense({
  ms,
  fallback,
  children,
}: {
  ms: number
  fallback?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={fallback}>
      <Suspense fallback={<Delay ms={ms}>{fallback}</Delay>}>
        {children}
      </Suspense>
    </Suspense>
  )
}
```

The nested structure creates a natural race without any `Promise.race` in userland — it falls out of React's own boundary resolution logic:

1. Children suspend → inner boundary catches it, tries to render its fallback (`<Delay>`)
2. `<Delay>` itself suspends for `ms` → outer boundary catches it, renders nothing
3. **If children resolve before `ms`:** inner boundary resolves, `<Delay>` never renders, content appears inline
4. **If `ms` expires first:** `<Delay>` resolves, inner fallback commits, real fallback UI appears — children stream in later

```
Timeline — children resolve at 80ms, ms=200:

t=0ms   → Children suspend
          Inner boundary catches, starts rendering <Delay ms={200}>
          <Delay> suspends → outer boundary catches
t=80ms  → Children resolve
          Inner boundary resolves directly with content
          <Delay> never commits — outer boundary resolves too
          Content appears inline, no fallback ever shown ✓

Timeline — children resolve at 500ms, ms=200:

t=0ms   → Children suspend
          Inner boundary catches, starts rendering <Delay ms={200}>
          <Delay> suspends → outer boundary catches
t=200ms → <Delay> resolves
          Inner boundary commits its fallback (the real fallback UI)
          Outer boundary resolves — fallback now visible to user
t=500ms → Children resolve
          Inner boundary swaps fallback for content
          Content streams in, replaces fallback ✓
```

**`cache()` is critical.** Without it, `new Promise` in render creates a fresh promise on every React retry, resetting the timer forever. React 19's `cache()` is per-request on the server and per-render on the client — exactly the right scoping.

**Server behavior:** the delay genuinely holds the stream. React waits for the outer boundary to resolve before flushing that section.

**Client behavior:** `use()` with a pending promise causes a re-render cycle but the component tree stays interactive. The hold isn't a hard block — just a deferred commit. Arguably better UX on the client.

### Props

- `ms` — milliseconds to wait before showing the fallback. This is a latency budget, not a guarantee.
- `fallback` — the fallback UI, same as `<Suspense fallback={...}>`. Shown only after `ms` expires.

### Rules

- `ms` is in milliseconds. No string durations — this is a latency budget, not a cache TTL.
- If the boundary resolves before its deadline, it renders immediately — it does not wait for the remaining time.
- Nested `<DeferredSuspense>` boundaries are valid. Each has its own independent deadline.
- `<DeferredSuspense ms={0}>` is equivalent to a regular `<Suspense>` — just use `<Suspense>` directly.
- Dev-mode warning if `<DeferredSuspense>` wraps `{children}` in a layout (same footgun as regular Suspense wrapping children, but worse because it adds latency).

### When to Use `<DeferredSuspense>`

- A secondary data fetch is usually fast (< 200ms) and you'd rather wait than flash a skeleton.
- You want to avoid layout shift from a spinner that appears for 50ms then disappears.
- A slow DB query *might* be fast — give it a grace period, but don't block the page on it.

### When Not to Use `<DeferredSuspense>`

- The content needs to affect the status code. Fetch it outside any Suspense boundary. Wrapping something in `<DeferredSuspense>` is a declaration that it doesn't drive denials, redirects, or headers.
- The content is known to be slow (> 1s). Just use `<Suspense>` — the user should see the fallback immediately.
- You're wrapping `{children}` in a layout. Use `useNavigationPending()` instead.

### `<DeferredSuspense>` and the Hold Window

`<DeferredSuspense>` extends the hold window. The hold window is defined by whether the HTTP status has committed, not by component structure. If the status has not committed yet and a signal (`deny()`, `redirect()`, etc.) is thrown inside a `<DeferredSuspense>`, the signal is promoted to pre-flush semantics — the framework can still send the correct HTTP status code.

This means a `<DeferredSuspense ms={500}>` can produce a correct 404 if `deny(404)` fires at t=200ms (status not yet committed), but a degraded 200 if it fires at t=600ms (status already committed and shell flushed). The behavior is timing-dependent by design — the hold window promotion applies equally to regular `<Suspense>` and `<DeferredSuspense>`. The contract remains: **do not rely on Suspense-wrapped content to affect the status code.** If content must drive the status code, fetch it outside any boundary.
