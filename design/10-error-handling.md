# Error Handling

## Two Phases, Two Error Systems

Errors in timber.js fall into one of two phases, and the phase determines how the error is handled.

**Handler-phase errors** happen before any rendering begins. A handler that throws produces an HTTP 500 with no body. There is no React error boundary involved — rendering never started. The 500 is clean and the status code is correct.

**Render-phase errors** happen inside the React tree. These are caught by error boundaries — `error.tsx` for general errors, status-code files (`5xx.tsx`, `4xx.tsx`, `403.tsx`, `404.tsx`, etc.) for status-specific handling.

### Error Boundary Architecture

Error boundaries are injected per-segment during element tree construction, wrapping page content **inside** layouts (not outside). This means error fallbacks preserve the layout shell — headers, navigation, and sidebars remain visible when an error fires.

Error boundaries are **not keyed** per-route — a route-based key would force React to unmount/remount the boundary subtree on every navigation, destroying layout client component state (counters, form inputs, etc.). Instead, `componentDidUpdate` resets the error state when `children` change on client-side navigation.

The wrapping order per segment (innermost to outermost):
1. Specific status files (`403.tsx`, `503.tsx`) — highest priority
2. Category catch-alls (`4xx.tsx`, `5xx.tsx`)
3. `error.tsx` — catches anything unmatched

For initial HTML render, if `deny()` fires outside Suspense, the RSC `onError` callback captures it. Even though the error boundary may catch the error during SSR, the pipeline detects the deny signal and re-renders with `renderDenyPage` to produce the correct HTTP status code. The boundary is harmless in this case.

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

> **Known limitation: deny() inside Suspense and hydration.**
> Error boundaries are keyed per-route and wrap page content inside layouts. When `deny()` fires inside a `<Suspense>` boundary after the SSR shell flushes, the server-rendered HTML correctly shows the page shell with the Suspense fallback. However, during client hydration React retries the Suspense content, re-throws the deny signal, and the error boundary catches it — replacing the page shell with the error page. The net result is the error page renders with a 200 status. This matches Next.js behavior. A future improvement may suppress error boundary activation for errors already handled server-side in a Suspense boundary.

---

## Status-Code Files

File conventions named by HTTP status code. Co-located with route segments. The file name is the status code the framework renders them for. Any specific status code can have its own file (e.g. `429.tsx`, `503.tsx`).

```
app/
  error.tsx        ← root-level error boundary (catches all errors)
  404.tsx          ← root-level 404 fallback
  404.mdx          ← MDX variant (when "mdx" in pageExtensions)
  dashboard/
    403.tsx        ← renders when deny() or deny(403) in this segment
    404.tsx        ← renders when deny(404) in this segment
    429.tsx        ← renders when deny(429) in this segment
    4xx.tsx        ← catches any other 4xx in this segment
    5xx.tsx        ← server errors with 5xx status in this segment
    error.tsx      ← error boundary for this segment (catches anything not matched above)
  api/
    401.json       ← JSON response for deny(401) in API routes
    4xx.json       ← catch-all JSON for any 4xx in API routes
    route.ts
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

### Status-Code File Variants

Status-code files support three formats: **component** (`.tsx`/`.jsx`/`.ts`/`.js`), **MDX** (`.mdx`/`.md`), and **static JSON** (`.json`). The format determines how the file is rendered and whether the app shell (layouts) wraps the output.

```
app/
  404.tsx          ← React component (rendered inside app shell)
  404.mdx          ← MDX content (rendered as RSC, inside app shell)
  api/
    401.json       ← static JSON (returned verbatim, no shell)
    4xx.json       ← catch-all JSON for API errors
    route.ts
```

**MDX status files** follow the same gate as `page.mdx`: only recognized when `"mdx"` (or `"md"`) is in `pageExtensions`. MDX status files are server components by default — zero client JS. They receive the same props as TSX status files (`{ status, dangerouslyPassData }` for 4xx).

**JSON status files** (`.json` extension) return the file contents verbatim with `Content-Type: application/json`. No React rendering pipeline. No layout wrapping. The JSON file is read and returned as-is. JSON status files are always recognized regardless of `pageExtensions` — `.json` is not a page extension, it's a data format.

### Format Selection for `deny()`

When `deny()` fires, the framework selects the response format based on context:

- **Route handlers (`route.ts`)** — JSON only. Prefer `.json` variant; fall back to bare JSON `{"error": true, "status": <N>}`. Never render a component for API routes.
- **Page routes (`page.tsx`/`page.mdx`)** — prefer component variant (`.tsx`/`.mdx`). If no component variant exists in the segment chain, fall back to `.json` if available. This means a segment with only `401.json` (no `401.tsx`) will return JSON for both API and page route denials.

**API routes never cross to components.** If a route handler triggers `deny()` but no `.json` status file exists, the framework returns a bare JSON response: `{"error": true, "status": <N>}`. It does not fall back to rendering a TSX/MDX component for an API consumer.

### Format-Aware Fallback Chains

Component and JSON files form separate fallback chains. Page routes try the component chain first, then the JSON chain. Route handlers use the JSON chain exclusively.

**Component chain (page routes, primary):**
`401.tsx` → `4xx.tsx` → walk up segments → legacy compat → `error.tsx` → *then try JSON chain* → framework default HTML.

**JSON chain (route handlers, or page route fallback):**
`401.json` → `4xx.json` → walk up segments → framework default JSON (`{"error": true, "status": <N>}`).

The JSON chain has no `error.json` equivalent — `error.tsx` is a React error boundary concept with `reset()` that has no JSON counterpart. JSON fallback terminates at the category catch-all level.

### Shell Opt-Out (`export const shell`)

By default, TSX/MDX status-code files render inside the app shell — root layout, segment layouts, etc. This preserves navigation, sidebars, and other layout chrome around error pages.

Status-code files can opt out of the shell by exporting `shell = false`:

```tsx
// app/api/401.tsx
export const shell = false;  // render without root/segment layouts

export default function Unauthorized({ status }: { status: number }) {
  return <html><body><h1>401 Unauthorized</h1></body></html>
}
```

When `shell = false`, the status-code component renders standalone — no layouts wrap it. The component is responsible for its own `<html>` and `<body>` tags if needed.

**Default:** `shell` defaults to `true` for TSX/MDX status files (backwards compatible). JSON files always skip the shell regardless — there is no `shell` export for JSON.

**Suspense boundary constraint:** `shell = false` is incompatible with Suspense boundaries in the route tree. Once streaming has started through the shell, layouts are already committed to the response and cannot be unwrapped. If a status-code file exports `shell = false` and the deny signal originates from within a Suspense boundary, the framework emits a dev-mode runtime error and falls back to rendering with the shell in production (silent degradation to safe behavior).

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

For API routes (`route.ts`), `deny()` automatically selects `.json` status files when available, returning structured JSON errors instead of HTML error pages. This means a single `deny(401)` call produces the correct response format for both page and API consumers.

---

## `redirect()` — Two Contexts, One Function

`redirect()` behaves differently depending on where it is called, but the developer-facing API is the same function.

**In a handler** — returns a Response directly. The handler stops. Rendering never starts. HTTP 3xx with `Location` header. Correct and clean.

**In a component (outside Suspense)** — throws a redirect signal. Caught by the framework root boundary before `onShellReady`. Render is discarded. HTTP 3xx sent. Status code correct.

**In a component (inside Suspense, during hold window)** — the status has not yet committed. The framework promotes this to pre-flush behavior: render is discarded, HTTP 3xx sent. Status code correct. Same as outside Suspense.

**In a component (inside Suspense, after flush)** — the status is already committed. The framework performs a client-side redirect by injecting a navigation instruction into the stream. The HTTP status is already 200. Dev-mode warning is emitted — this is degraded behavior.

**In a server action** — throws a redirect signal. The action response carries the redirect. Client navigates. Runs the full handler for the new route.

Same function name, correct behavior in each context, client-side fallback where the semantics cannot be preserved.
