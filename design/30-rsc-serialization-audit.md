# RSC-to-Client Serialization Audit

## Background

React Server Components serialize data across the RSC→client boundary via the React Flight protocol. This document catalogs which types survive each boundary in timber.js, where users may hit sharp edges, and what improvements we should make.

timber.js uses React 19.2.4 with `@vitejs/plugin-rsc` ~0.5.21, which bundles `react-server-dom-webpack` (the same Flight protocol used by Next.js). The Flight protocol implementation is identical — **there is no difference between `@vitejs/plugin-rsc`'s serializer and Next.js's**. The plugin is a thin wrapper that delegates to the React vendored Flight code.

---

## Serialization Boundaries

Data crosses three boundaries in timber.js:

| Boundary | Mechanism | When |
|----------|-----------|------|
| RSC → SSR | `renderToReadableStream` (RSC) → `createFromReadableStream` (SSR) | Every page render |
| RSC → Client (hydration) | RSC stream tee'd and inlined as `<script>` tags → `createFromReadableStream` (browser) | Initial page load |
| RSC → Client (navigation) | RSC stream returned directly → `createFromFetch` (browser) | Client-side navigation |
| Server Action → Client | `renderToReadableStream` of action return value → `createFromFetch` | Server action response |
| Client → Server Action | `encodeReply` (browser) → `decodeReply` (server) | Action argument passing |

All boundaries use the same Flight protocol. **A type that survives one boundary survives all of them.**

---

## Type Support Matrix

### Types that survive RSC→Client (React 19 Flight protocol)

| Type | Serialized? | Round-trips correctly? | Notes |
|------|-------------|----------------------|-------|
| `string` | ✅ | ✅ | |
| `number` | ✅ | ✅ | Including `NaN`, `Infinity`, `-Infinity`, `-0` |
| `boolean` | ✅ | ✅ | |
| `null` | ✅ | ✅ | |
| `undefined` | ✅ | ✅ | |
| `BigInt` | ✅ | ✅ | Serialized as `$n` prefix + decimal string |
| `Date` | ✅ | ✅ | Serialized as `$D` + ISO string via `.toJSON()` |
| `Map` | ✅ | ✅ | Serialized as entries |
| `Set` | ✅ | ✅ | Serialized as values |
| `Promise<T>` | ✅ | ✅ | Serialized as `$@` + streaming resolution. `T` must be serializable |
| `FormData` | ✅ | ✅ | |
| `Blob` | ✅ | ✅ | |
| `ArrayBuffer` | ✅ | ✅ | |
| `TypedArray` | ✅ | ✅ | All variants: `Int8Array`, `Uint8Array`, `Float32Array`, etc. |
| `DataView` | ✅ | ✅ | |
| `ReadableStream` | ✅ | ✅ | Streaming — chunks forwarded progressively |
| `AsyncIterator` | ✅ | ✅ | Streaming |
| `Iterator/Iterable` | ✅ | ✅ | Converted to array, or self-referencing iterators serialized as `$i` |
| `Error` | ✅ | ⚠️ | Serialized via `onError` digest. Message survives; stack trace does NOT (by design — security). Custom properties stripped. |
| React elements | ✅ | ✅ | Server components rendered; client component references serialized |
| Plain objects | ✅ | ✅ | Must be plain (no custom prototype, no methods, no symbol keys) |
| Arrays | ✅ | ✅ | |

### Types that do NOT survive

| Type | What happens | User-facing behavior |
|------|-------------|---------------------|
| `RegExp` | Throws: "Only plain objects can be passed to Client Components" | Dev error in console; production silent error |
| `Symbol` | Not serializable | Error |
| Class instances | Throws: "Classes or null prototypes are not supported" | Must convert to plain object first |
| `WeakMap` | Not serializable | Error |
| `WeakSet` | Not serializable | Error |
| Functions | Not serializable (unless server/client reference) | Error |
| `URL` | Class instance — throws | Must pass `.toString()` or `.href` |
| `Headers` | Class instance — throws | Must convert to plain object |

---

## Analysis by Question

### 1. Promises as Props

**Verdict: ✅ Works correctly.**

React 19 Flight natively supports `Promise<T>` as a prop. The promise is serialized as a streaming reference (`$@` prefix) — the RSC stream emits the resolved value when the promise settles, and the client receives it as a real `Promise` that resolves with the deserialized value.

timber.js's pipeline does NOT interfere with this mechanism:
- `renderToReadableStream` in `rsc-entry/index.ts:372` serializes the element tree including promise props
- The RSC stream is tee'd (`rsc-entry/index.ts:597`) — one copy to SSR, one inlined for hydration
- SSR's `createFromReadableStream` (`ssr-entry.ts:130`) decodes promise references and passes them through to `renderToReadableStream` (React DOM), which handles Suspense boundaries
- The browser's `createFromReadableStream` (`browser-entry.ts:241`) decodes promise references for hydration

**The `use` hook pattern works:**
```tsx
// Server component
async function ProductPage() {
  const reviewsPromise = getReviews(id); // Don't await
  return <ReviewList reviews={reviewsPromise} />;
}

// Client component
'use client';
import { use } from 'react';
function ReviewList({ reviews }: { reviews: Promise<Review[]> }) {
  const data = use(reviews); // Suspends until resolved
  return <ul>{data.map(r => <li key={r.id}>{r.text}</li>)}</ul>;
}
```

**Streaming + promises + `deferSuspenseFor`**: When a server component passes a promise to a client component inside `<Suspense>`, the promise resolution is streamed. `deferSuspenseFor` delays the first SSR stream read (`ssr-render.ts:80-87`), racing `allReady` against the timeout. This is independent of Flight promise serialization — it operates at the HTML stream level. Fast-resolving promises benefit from the hold window.

### 2. Date, Map, Set, RegExp

**Verdict: Date ✅, Map ✅, Set ✅, RegExp ❌**

React 19 Flight serializes `Date`, `Map`, and `Set` natively. These types survive all boundaries in timber.js with no timber-specific code needed.

`RegExp` is **not supported** by Flight. Passing a `RegExp` as a prop to a client component throws in dev mode and silently errors in production. This is the same behavior as Next.js — it's a React limitation, not a timber limitation.

**No timber-specific sharp edges here.** The types that work in Next.js work in timber.js because the Flight serializer is identical.

### 3. `dangerouslyPassData`

**Verdict: ⚠️ Goes through Flight — limited to Flight-serializable types. Should be typed more strictly.**

`dangerouslyPassData` is passed as a React prop to status-code files. The data flow:

1. `deny(status, data)` stores `data` on `DenySignal.data` (`primitives.ts:14`)
2. **Pre-flush path**: `renderDenyPage` passes it as a prop to the status-code component (`deny-renderer.ts:125`), which goes through a fresh `renderToReadableStream` call (`deny-renderer.ts:165`). The data traverses the full Flight serialization path.
3. **Post-flush path** (inside Suspense): The RSC `onError` callback serializes `deny.data` into the digest as JSON (`rsc-entry/index.ts:383`). The client error boundary reads it back (`error-boundary.tsx:146`). This path uses `JSON.stringify`/`JSON.parse`, NOT Flight.

**Implications:**
- Pre-flush: `dangerouslyPassData` supports all Flight-serializable types (Date, Map, Set, BigInt, etc.)
- Post-flush (inside Suspense): `dangerouslyPassData` only supports JSON-serializable types. `Date` becomes a string, `Map`/`Set`/`BigInt` are silently dropped or coerced.
- The design doc says "Data must be JSON-serializable" — this is correct for the post-flush path but overly restrictive for pre-flush. However, since users can't control which path runs (it depends on Suspense boundary placement), **the effective contract should be JSON-serializable**.

**Follow-up**: Add a dev-mode warning when non-JSON-serializable data is passed to `deny()`. The current typing as `unknown` is too loose.

### 4. Server Action Return Values

**Verdict: ✅ Full Flight serialization support.**

Server action responses go through `renderToReadableStream` (`action-handler.ts:235`). The action return value is the `data` argument to `renderToReadableStream`, which runs it through the full Flight serializer. All Flight-supported types (Date, Map, Set, Promise, BigInt, TypedArray, etc.) survive.

The with-JS path (`handleRscAction`) returns an RSC stream; the client decodes it via `createFromFetch`. The no-JS path (`handleFormAction`) re-renders the page with the action result as flash data — this path goes through server-side rendering and doesn't need client serialization.

**Error path**: `handleActionError` sanitizes errors before serialization. `ActionError` gets its code/data (JSON-serializable); unexpected errors get `{ code: 'INTERNAL_ERROR' }`. This is correct — no server state leakage.

### 5. `React.cache` Scope and Complex Types

**Verdict: ✅ No issue. Cached values don't cross the Flight boundary.**

`React.cache` stores values in memory within the RSC render pass. Cached values (including Dates, Maps, class instances) are never serialized by Flight — they're consumed within the server-side React tree. Only values that are **passed as props to client components** go through Flight.

Example: `React.cache` returns a `User` class instance. A server component reads `user.name` and passes the string to a client component. The class instance never touches Flight.

If a developer directly passes a cached class instance as a prop to a client component, Flight will throw — but this is correct behavior, not a bug.

### 6. Streaming + Promises

**Verdict: ✅ Works correctly with `deferSuspenseFor`.**

The `deferSuspenseFor` mechanism (`ssr-render.ts:77-87`) operates at the HTML stream level, independent of Flight promise serialization:

1. RSC `renderToReadableStream` serializes the element tree, encoding promise props as streaming references
2. SSR `createFromReadableStream` decodes the Flight stream into a React element tree with real promises
3. SSR `renderToReadableStream` (React DOM) renders HTML, using Suspense for unresolved promises
4. `deferSuspenseFor` delays reading the HTML stream, giving fast promises time to resolve inline

The two streaming mechanisms (Flight promise streaming and SSR Suspense streaming) are independent and compose correctly. A promise passed to a client component inside `<Suspense>`:
- Resolves in the Flight stream when the promise settles
- The SSR Suspense boundary waits for the `use()` hook to unsuspend
- `deferSuspenseFor` holds the HTML flush, potentially inlining the content

---

## Comparison with Next.js

**No behavioral differences.** timber.js uses the same React Flight protocol implementation (vendored `react-server-dom-webpack` from React 19). The `@vitejs/plugin-rsc` package is a thin wrapper that provides module resolution — it does not modify, filter, or transform the Flight serialization.

Types that work in Next.js work in timber.js. Types that don't work in Next.js don't work in timber.js. The Flight protocol is the single source of truth for serialization behavior.

---

## Identified Improvements

### 1. Dev-mode warning for non-serializable props (Follow-up issue)

React's dev build already logs "Only plain objects can be passed to Client Components" when an unsupported type is detected. However, the warning is generic and doesn't mention timber-specific context. A timber-level dev warning could:
- Detect common mistakes (passing `URL` objects, class instances, `RegExp`)
- Suggest the fix (`.toString()`, `.href`, spreading to plain object)
- Reference this audit document

### 2. Tighten `dangerouslyPassData` typing (Follow-up issue)

`deny(status, data)` accepts `unknown` for `data`. Since the post-flush path serializes via JSON (not Flight), the type should be constrained to `JsonSerializable` to prevent silent data loss when `deny()` fires inside a Suspense boundary.

### 3. Document serialization behavior (Follow-up issue)

Add a user-facing guide covering:
- What types can be passed from server to client components
- The promise-as-prop pattern with `use()` and `<Suspense>`
- Common pitfalls (RegExp, URL, class instances)

### 4. Audit `onError` digest serialization for consistency (No issue found)

The `onError` callback in `rsc-entry/index.ts:376-411` uses `JSON.stringify` for the digest, which is correct — the digest crosses the RSC→client boundary as a string attribute on the Error, not as a Flight-serialized value. `RenderError.digest.data` should be JSON-serializable, and the current typing (`TData = unknown`) allows non-serializable data that would be silently dropped. Same fix as #2 — constrain to `JsonSerializable`.

---

## Test Plan

E2E tests should verify:
1. `Date` prop survives RSC→client hydration
2. `Map` prop survives RSC→client hydration
3. `Set` prop survives RSC→client hydration
4. `BigInt` prop survives RSC→client hydration
5. `Promise<T>` prop works with `use()` hook in client component
6. Server action returning `Date` receives correct value on client
7. `dangerouslyPassData` with plain object survives deny page rendering
