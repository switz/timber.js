# Error Handling

## Two Phases, Two Error Systems

Errors in timber.js fall into one of two phases, and the phase determines how the error is handled.

**Handler-phase errors** happen before any rendering begins. A handler that throws produces an HTTP 500 with no body. There is no React error boundary involved — rendering never started. The 500 is clean and the status code is correct.

**Render-phase errors** happen inside the React tree. These are caught by error boundaries — `error.tsx` for general errors, status-code files (`5xx.tsx`, `4xx.tsx`, `403.tsx`, `404.tsx`, etc.) for status-specific handling.

## `error.tsx`

The general React error boundary. Co-located with route segments. Catches any unhandled error thrown during rendering of that segment and its children — both server-side render errors and client-side errors. Same role as Next.js's `error.tsx`.

```tsx
// app/dashboard/error.tsx
'use client'

export default function DashboardError({ error, reset }) {
  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

If a more specific status-code file exists (e.g. `5xx.tsx`, `503.tsx`), it takes priority for errors with that status. `error.tsx` catches everything that doesn't match a specific status-code file.

Because timber.js buffers until `onShellReady`, a render-phase error that occurs outside a `<Suspense>` boundary is caught before the status code commits. The framework sends a real HTTP 500 with the error boundary output as the response body — not a 200 with an error boundary rendered inside a successful page.

A render-phase error inside a `<Suspense>` boundary occurs after the status has committed. The framework streams the error boundary output into the open connection. The status code is already 200 — this is the one case where the status is unavoidably wrong, and it's the developer's choice because they placed the Suspense boundary.

## The Hold Window

Since the handler runs before rendering, the hold window is the gap between `onShellReady` firing and the response being flushed. During this window, the status code has not committed — no bytes are on the wire.

If an error, `deny()`, or `redirect()` is thrown inside a `<Suspense>` boundary during the hold window, it is treated as if it were thrown outside Suspense — it can affect the status code. The rationale: the status hasn't committed yet, so there's no reason to degrade behavior. The framework promotes hold-window Suspense errors to pre-flush semantics.

Once the hold window closes (both conditions met, status committed, shell flushed), Suspense errors revert to post-flush behavior — streamed into the open connection with the status already set.

---

## Passing Structured Error Data to Error Boundaries

The `error` prop received by error boundaries (`error.tsx`, `5xx.tsx`, etc.) is a plain `Error` object. In production, React strips unknown error properties before crossing the RSC → client boundary — only `message` survives. This means a server component cannot pass structured context (an error code, a resource ID, a user-friendly title) to its error boundary through the thrown error alone.

timber.js solves this with `RenderError` — a typed throw that carries a plain-data digest alongside the error, with an optional HTTP status code.

```typescript
import { RenderError } from '@timber/app/server'

// In a server component:
if (!product) {
  throw new RenderError('PRODUCT_NOT_FOUND', {
    title: 'Product not found',
    resourceId: params.id,
  })
}

// With custom status code (default is 500):
if (!user.canView(resource)) {
  throw new RenderError('FORBIDDEN', {
    title: 'Access denied',
  }, { status: 403 })
}
```

The third argument is an options object. `status` defaults to `500`. Any valid HTTP error status code (4xx, 5xx) is accepted. The status code is used when the error occurs outside a `<Suspense>` boundary (or during the hold window) — it becomes the HTTP status code on the response. Inside a post-flush `<Suspense>` boundary, the status is already committed and the `status` option has no effect.

The digest is a plain JSON-serializable object. timber.js serializes it into the RSC stream separately from the Error instance. The framework reconstitutes it on the client and passes it as a second prop to the error boundary:

```tsx
// app/products/error.tsx
'use client'

import type { RenderErrorDigest } from '@timber/app/client'

export default function ProductError({
  error,
  digest,
  reset,
}: {
  error: Error
  digest: RenderErrorDigest<'PRODUCT_NOT_FOUND', { title: string; resourceId: string }> | null
  reset: () => void
}) {
  return (
    <div>
      <h2>{digest?.data.title ?? 'Something went wrong'}</h2>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

`digest` is `null` when the error was not a `RenderError` — an unexpected crash, a third-party throw, etc. Error boundaries handle both cases by checking for null.

The type parameter to `RenderErrorDigest` is inferred from the throw site when `satisfies` typing is used, or declared explicitly for cross-file sharing.

### Why Not Serialize the Error Directly?

Serializing arbitrary `Error` subclasses across the RSC boundary is a security footgun — stack traces, internal state, and sensitive context can leak. `RenderError` makes the contract explicit: the developer decides what data crosses the boundary, and it must be plain JSON. The underlying `Error` instance never leaves the server.

### `RenderError` in Server Actions

`RenderError` is not for server actions — use `ActionError` there. `RenderError` is strictly a render-phase primitive for passing structured context to error boundaries. If an action needs to communicate a typed error to the UI, it returns it through the action result shape (`result.serverError`).

### Relationship to `deny()` and `redirect()`

`deny()` and `redirect()` are still preferred over `RenderError` when the intent is access control or routing — they produce correct HTTP status codes and render the appropriate status-code file. `RenderError` is for cases where the page should render an error boundary with typed context rather than deny or redirect.

---

## `deny()` — Universal Denial

`deny()` is the universal denial primitive. Accepts any 4xx status code. It produces the correct HTTP status code based on context:

```typescript
import { deny } from '@timber/app/server'

deny()      // 403 Forbidden (default)
deny(404)   // 404 Not Found
deny(401)   // 401 Unauthorized
deny(403)   // 403 Forbidden (explicit)
deny(429)   // 429 Too Many Requests
deny(404, { resourceId: params.id })  // data passed as dangerouslyPassData prop to status-code file
```

### Behavior by Context

**In segment `access.ts` (outside Suspense)** — throws a render-phase signal. Caught before `onShellReady`. HTTP status code is correct. The nearest status-code file (`403.tsx`, `404.tsx`, etc.) is rendered as the response body.

**In a page component (outside Suspense)** — same as segment access. Correct HTTP status.

**In slot `access.ts`** — graceful degradation. Slot renders `denied.tsx`, parent layout and sibling slots unaffected. HTTP status unaffected. The `data` argument is passed to `denied.tsx` as the `dangerouslyPassData` prop.

**Inside `<Suspense>` (during hold window)** — promoted to pre-flush behavior. Same as outside Suspense.

**Inside `<Suspense>` (after flush)** — status is already committed (200). The error boundary renders inline. Dev-mode warning is emitted. A `<meta name="robots" content="noindex">` tag is injected.

---

## Status-Code Files

File conventions named by HTTP status code. Co-located with route segments. The file name is the status code the framework renders them for. Any specific status code can have its own file (e.g. `429.tsx`, `503.tsx`).

```
app/
  error.tsx        ← root-level error boundary (catches all errors)
  404.tsx          ← root-level 404 fallback
  dashboard/
    403.tsx        ← renders when deny() or deny(403) in this segment
    404.tsx        ← renders when deny(404) in this segment
    429.tsx        ← renders when deny(429) in this segment
    4xx.tsx        ← catches any other 4xx in this segment
    5xx.tsx        ← server errors with 5xx status in this segment
    error.tsx      ← error boundary for this segment (catches anything not matched above)
```

### Fallback Chain

The fallback chain walks segments from leaf to root. At each segment level, it checks the exact status file first, then the category catch-all. A nearer segment's `4xx.tsx` wins over a farther segment's `403.tsx`.

**For 4xx (`deny()`):** At each segment (leaf → root): `{status}.tsx` → `4xx.tsx`. Then legacy compat (`forbidden.tsx`/`unauthorized.tsx`/`not-found.tsx`). Then `error.tsx` (leaf → root). Then framework default.

For `deny(403)`: `403.tsx` → `4xx.tsx` → walk up segments → legacy `forbidden.tsx` → `error.tsx` → default framework page.

For `deny(404)`: `404.tsx` → `4xx.tsx` → walk up segments → legacy `not-found.tsx` → `error.tsx` → default framework page.

For `deny(429)`: `429.tsx` → `4xx.tsx` → walk up segments → `error.tsx` → default framework page.

**For 5xx (`RenderError` / unhandled error):** At each segment (leaf → root): `{status}.tsx` → `5xx.tsx` → `error.tsx`. Then `global-error.tsx`. Then framework default.

For `RenderError` with `{ status: 503 }`: `503.tsx` → `5xx.tsx` → `error.tsx` → walk up segments → `global-error.tsx` → default framework page.

For unhandled render error: `5xx.tsx` → `error.tsx` → walk up segments → `global-error.tsx` → default framework page.

For client-side error: `error.tsx` → walk up segment tree → default framework page.

### Status-Code File Props

**4xx files** (`401.tsx`, `403.tsx`, `404.tsx`, `429.tsx`, `4xx.tsx`, etc.) — receive `{ status, dangerouslyPassData }` where `status` is the HTTP status code and `dangerouslyPassData` is the optional second argument from `deny(status, data)`.

The prop is named `dangerouslyPassData` to signal that this data crosses the RSC → client serialization boundary. Data must be JSON-serializable. Do not pass sensitive server-side state (database records, tokens, internal IDs) — only data intended for display or client-side logic.

```tsx
// app/404.tsx
'use client'

export default function NotFound({ status, dangerouslyPassData }: { status: number; dangerouslyPassData?: unknown }) {
  return <h1>Page not found</h1>
}
```

**5xx files and `error.tsx`** — receive `{ error, digest, reset }`. Client components. `error.tsx` is the general error boundary (same as Next.js `error.tsx`). `5xx.tsx` and specific files like `503.tsx` handle server errors with that status code.

```tsx
// app/error.tsx
'use client'

export default function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

### Slot `denied.tsx`

Slots use `denied.tsx` instead of status-code files because slot denial has no HTTP status on the wire — it's graceful degradation, not a page-level error. The `denied.tsx` file is co-located with the slot directory. Fallback chain: `denied.tsx` → `default.tsx` → `null`.

`denied.tsx` receives two props: `slot` — the name of the slot that was denied (the directory name without the `@` prefix), and `dangerouslyPassData` — optional data from `deny(status, data)` in the slot's `access.ts`. No status code (there is no HTTP status for slot denial), no error object (denial is intentional, not exceptional).

```tsx
// @admin/denied.tsx
export default function AdminDenied({ slot, dangerouslyPassData }: { slot: string; dangerouslyPassData?: unknown }) {
  return <div className="text-muted">Admin access required</div>
}
```

### Relationship to Other Primitives

| Primitive | HTTP Status | Renders | Use When |
|---|---|---|---|
| `redirect(path)` | 302 | Nothing (location change) | User should go somewhere else |
| `deny()` | 403 (default) | `403.tsx` → `4xx.tsx` → `error.tsx` | Authenticated but not authorized |
| `deny(404)` | 404 | `404.tsx` → `4xx.tsx` → `error.tsx` | Resource doesn't exist |
| `deny(401)` | 401 | `401.tsx` → `4xx.tsx` → `error.tsx` | Not authenticated |
| `deny(status, data)` | Any 4xx | `{status}.tsx` → `4xx.tsx` → `error.tsx` | Denial with typed context |
| `throw new RenderError(...)` | Custom (default 500) | `{status}.tsx` → `5xx.tsx` → `error.tsx` | Application error with typed context |
| Unhandled throw | 500 | `5xx.tsx` → `error.tsx` | Unexpected crash |

`deny(401)` vs `redirect('/login')`: Use `deny(401)` when the client should know the request was rejected due to missing auth (API consumers, `curl`, CDNs that cache by status code). Use `redirect('/login')` when the user should be seamlessly sent to a login page (browser-facing pages).

---

## `redirect()` — Two Contexts, One Function

`redirect()` behaves differently depending on where it is called, but the developer-facing API is the same function.

**In a handler** — returns a Response directly. The handler stops. Rendering never starts. HTTP 3xx with `Location` header. Correct and clean.

**In a component (outside Suspense)** — throws a redirect signal. Caught by the framework root boundary before `onShellReady`. Render is discarded. HTTP 3xx sent. Status code correct.

**In a component (inside Suspense, during hold window)** — the status has not yet committed. The framework promotes this to pre-flush behavior: render is discarded, HTTP 3xx sent. Status code correct. Same as outside Suspense.

**In a component (inside Suspense, after flush)** — the status is already committed. The framework performs a client-side redirect by injecting a navigation instruction into the stream. The HTTP status is already 200. Dev-mode warning is emitted — this is degraded behavior.

**In a server action** — throws a redirect signal. The action response carries the redirect. Client navigates. Runs the full handler for the new route.

Same function name, correct behavior in each context, client-side fallback where the semantics cannot be preserved.
