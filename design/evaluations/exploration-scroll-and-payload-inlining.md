# Exploration: Scroll Restoration & RSC Payload Inlining

> **Status: Exploration only — do not implement.**
> This document compares timber.js's current approach to Next.js's patterns for scroll restoration and RSC payload inlining. It exists to record findings and inform future decisions, not to prescribe changes.

---

## Context

During implementation of E2E navigation tests (PR #56), we discovered that rendering to the `document` root via `reactRoot.render()` causes the browser to reset scroll to 0 during DOM reconciliation. This required workarounds for scroll preservation (`scroll={false}`) and scroll restoration (back/forward). We also implemented RSC payload inlining as a buffered byte array.

This document compares our solutions with Next.js's approach, based on a code review of `~/y/next.js`.

---

## 1. Scroll Timing: `afterPaint` vs `useLayoutEffect`

### What we do

The router schedules all `scrollTo` calls via an `afterPaint` callback — double `requestAnimationFrame` in the browser, synchronous in tests. This runs **after** the browser paints.

```
renderPayload(payload)  →  rAF  →  rAF  →  scrollTo(0, y)
                                           ^ after paint
```

### What Next.js does

Next.js runs scroll logic inside a `useLayoutEffect` in the Layout Router component. This fires **after** React commits DOM but **before** the browser paints.

```
React render  →  DOM commit  →  useLayoutEffect(scrollTo)  →  paint
                                ^ before paint
```

The effect checks a mutable `focusAndScrollRef` object:

- `apply: true` → execute scroll, then set `apply = false`
- `apply: false` → no-op (used for `scroll={false}`)

### Trade-offs

|                      | timber.js (`afterPaint`)                                            | Next.js (`useLayoutEffect`)                                                          |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Timing**           | After paint — user may see 1 frame at wrong scroll                  | Before paint — no visible flash                                                      |
| **Complexity**       | 3 lines in browser-entry, router owns all scroll logic              | Requires a React component (`<ScrollManager>`), scroll intent passed via ref/context |
| **Testability**      | Router tests are pure (no React), `afterPaint` falls back to sync   | Scroll tests require React rendering                                                 |
| **Coupling**         | Zero React coupling — router is framework-agnostic                  | Scroll behavior depends on React commit lifecycle                                    |
| **`scroll={false}`** | Must actively save and restore (document root render resets scroll) | No-op: `apply = false`, layout reconciliation doesn't disturb scroll                 |

### Why `scroll={false}` differs

Next.js's Layout Router only re-renders the **changed segment** — parent layouts stay mounted and untouched, so scroll is naturally preserved. Our `reactRoot.render(element)` re-renders the **full document**, which triggers a browser scroll reset even when React preserves layout DOM nodes via reconciliation. This is why we must actively capture and restore scroll position.

### What it would take to adopt

Add a `<ScrollManager>` client component rendered inside the root layout:

```tsx
// Framework-internal, not user-facing
function ScrollManager() {
  const scrollRef = useScrollRef(); // reads from router context
  useLayoutEffect(() => {
    if (!scrollRef.current.apply) return;
    scrollRef.current.apply = false;
    window.scrollTo(scrollRef.current.x, scrollRef.current.y);
  });
  return null;
}
```

The router would set `scrollRef.current = { apply: true, x: 0, y: 300 }` instead of calling `afterPaint`. This eliminates the double-rAF, eliminates active `scroll={false}` restoration, and prevents the 1-frame flash.

**Prerequisite**: The `<ScrollManager>` must be injected into the RSC element tree by the framework (similar to how `AccessGate` is injected). It cannot be a user-land component.

### Why not now

The 1-frame flash at wrong scroll position is not user-visible in practice — the double-rAF fires within ~32ms. The active `scroll={false}` restoration works correctly. Adding a `<ScrollManager>` component introduces React coupling into the router for no measurable user benefit. Revisit if users report scroll jank.

---

## 2. RSC Payload Inlining: Buffered vs Streaming

### What we do

`injectRscPayload()` buffers the entire RSC stream to completion, encodes it as a comma-separated byte array, and injects a single `<script>` tag before `</body>`:

```html
<script>
window.__TIMBER_RSC_PAYLOAD = new ReadableStream({
  start(c) {
    c.enqueue(new Uint8Array([72,101,108,108,111,...]));
    c.close();
  }
});
</script>
</body>
```

The browser entry reads this via `createFromReadableStream`.

### What Next.js does

Next.js emits `<script>` tags **progressively** as the HTML streams. Each RSC chunk becomes a `self.__next_f.push()` call:

```html
<script>
  self.__next_f.push([1, '0:"$Sreact.fragment"\n1:...']);
</script>
<!-- more HTML streams... -->
<script>
  self.__next_f.push([1, '3:{"children":...}']);
</script>
```

A global array + ReadableStream controller feeds chunks to `createFromReadableStream` in real-time as the HTML arrives.

### Trade-offs

|                     | timber.js (buffered)                                   | Next.js (streaming)                                                        |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| **Hydration start** | After `</body>` — entire RSC payload must arrive first | Progressive — hydration can begin as RSC chunks arrive in HTML             |
| **TTFB impact**     | RSC stream must complete before HTML can close         | RSC chunks interleave with HTML streaming                                  |
| **Implementation**  | ~30 lines, simple TransformStream                      | Requires HTML stream interleaving, global callback pattern, chunk encoding |
| **Large pages**     | Delays `</body>` if RSC payload is large               | Streams naturally with HTML                                                |
| **Encoding**        | Binary (comma-separated bytes) — compact but opaque    | Text (JSON-escaped Flight protocol) — human-readable in view-source        |

### What it would take to adopt

1. Replace `injectRscPayload` with a `TransformStream` that intercepts the HTML stream
2. As each RSC chunk arrives from the tee'd inline stream, inject a `<script>self.__timber_f.push([1, chunk])</script>` into the HTML at the current stream position
3. On the client, replace `window.__TIMBER_RSC_PAYLOAD` with a global array + ReadableStream pattern that feeds chunks to `createFromReadableStream`
4. Handle edge cases: script tag splitting (RSC chunk arriving mid-HTML-tag), encoding (the Flight protocol text must be JSON-escaped inside the script tag)

### Why not now

The buffered approach works for all current page sizes. The delay between RSC completion and `</body>` is imperceptible for typical pages (<50KB RSC payload). Streaming inlining is a meaningful optimization only for large pages with significant RSC payloads. Revisit when we have real-world pages where TTFB matters and the RSC payload is the bottleneck.

---

## 3. Native Browser Scroll Restoration

### What we do

Explicitly store `scrollY` per history entry and restore via `afterPaint(() => scrollTo(0, savedScrollY))` on popstate.

### What Next.js does

Sets `history.scrollRestoration = 'manual'` and relies on the browser's native scroll restoration. Does NOT store scroll positions.

### Why we can't adopt this

Our `reactRoot.render()` on the document root resets scroll during DOM reconciliation. The browser's native restoration fires before React commits, so it gets overwritten. Next.js avoids this because their Layout Router only re-renders changed segments — the document scroll is never disturbed by React.

This is a fundamental architectural difference. Adopting native scroll restoration would require either:

- A per-segment rendering approach (Layout Router pattern) — major architectural change
- Confirming that `useLayoutEffect` scroll restoration (item #1) runs after React's document root reconciliation but before the browser's native restoration gets clobbered — unclear and browser-dependent

### Why not now

Explicit scroll storage is more reliable, predictable, and testable. It works identically across all browsers. The overhead is negligible (one number per history entry). No user-visible difference.

---

## Summary

| Pattern                           | Priority | Trigger to revisit                                            |
| --------------------------------- | -------- | ------------------------------------------------------------- |
| `useLayoutEffect` scroll          | Low      | Users report visible scroll jank (1-frame flash)              |
| Streaming RSC inlining            | Medium   | Large pages where TTFB is bottlenecked by RSC payload size    |
| Native browser scroll restoration | None     | Only possible after per-segment rendering (major arch change) |

All three patterns are well-understood. The current solutions work correctly and are simpler. Complexity should be added only when a concrete problem demands it.
