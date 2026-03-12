# Ecosystem Compatibility

## Import Path Strategy

timber.js provides two import surfaces:

1. **`@timber/app/*`** — Native timber imports. These are the primary API and should be used by timber-first code.
2. **`next/*`** — Shims for Next.js-compatible libraries. These enable ecosystem libraries that import from `next/*` public APIs to work unmodified.

The `next/*` shims are resolved at the Vite layer by the `timber-shims` plugin. They are **not** listed in `package.json` exports — they only exist during the Vite build/dev process.

### Decision: Keep Both Surfaces

We keep `next/*` shims indefinitely. Ecosystem library compatibility is a core value — libraries should work without forking. The shim surface is small (5 modules) and tracked closely against upstream Next.js.

---

## Shim Audit

### `next/link`

| Export             | Next.js                      | timber                            | Status      |
| ------------------ | ---------------------------- | --------------------------------- | ----------- |
| `Link` (default)   | React component (forwardRef) | Re-export of timber's `Link`      | Shimmed     |
| `Link` (named)     | Same as default              | Re-export of timber's `Link`      | Shimmed     |
| `LinkProps` (type) | Interface                    | Re-export of timber's `LinkProps` | Shimmed     |
| `useLinkStatus`    | Hook: `{ pending: boolean }` | —                                 | Not shimmed |

**Divergences:** `useLinkStatus` is not implemented. timber has `useNavigationPending()` which serves a similar purpose but with different semantics (global vs per-link). Low priority — no known ecosystem library uses it.

### `next/image`

| Export                    | Next.js                   | timber                   | Status         |
| ------------------------- | ------------------------- | ------------------------ | -------------- |
| `Image` (default)         | Optimized image component | Pass-through `<img>` tag | Shimmed (stub) |
| `Image` (named)           | Same as default           | Same as default          | Shimmed (stub) |
| `ImageProps` (type)       | Interface                 | Subset type              | Shimmed        |
| `getImageProps`           | Function                  | —                        | Not shimmed    |
| `ImageLoaderProps` (type) | Interface                 | —                        | Not shimmed    |
| `ImageLoader` (type)      | Type alias                | —                        | Not shimmed    |
| `StaticImageData` (type)  | Interface                 | —                        | Not shimmed    |

**Divergences:** timber does not implement image optimization. The Image component renders a plain `<img>` tag and silently ignores Next.js-specific props (`priority`, `quality`, `fill`, `placeholder`, `blurDataURL`). This is intentional — image optimization is out of scope for the initial release. `getImageProps` is not shimmed; no known ecosystem library depends on it.

### `next/navigation`

| Export                      | Next.js                        | timber                                                        | Status                                            |
| --------------------------- | ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------- |
| `useParams`                 | Hook                           | Re-export from `use-params.ts`                                | Shimmed                                           |
| `usePathname`               | Hook                           | `useSyncExternalStore` over `location.pathname`               | Shimmed                                           |
| `useSearchParams`           | Hook                           | `useSyncExternalStore` over `location.search`                 | Shimmed                                           |
| `useRouter`                 | Hook → `AppRouterInstance`     | Wraps timber's `RouterInstance`                               | Shimmed                                           |
| `redirect`                  | Function                       | Re-export from `primitives.ts`                                | Shimmed                                           |
| `notFound`                  | Function                       | Alias for `deny(404)`                                         | Shimmed                                           |
| `RedirectType`              | Const enum `{ push, replace }` | Const object                                                  | Shimmed                                           |
| `permanentRedirect`         | Function (308)                 | Delegates to `redirect(path, 308)`                            | Shimmed                                           |
| `useSelectedLayoutSegment`  | Hook                           | Reads segment depth from `SegmentProvider` context + pathname | Shimmed                                           |
| `useSelectedLayoutSegments` | Hook                           | Reads segment depth from `SegmentProvider` context + pathname | Shimmed                                           |
| `forbidden`                 | Function (experimental)        | —                                                             | Not shimmed                                       |
| `unauthorized`              | Function (experimental)        | —                                                             | Not shimmed                                       |
| `ReadonlyURLSearchParams`   | Class                          | —                                                             | Not shimmed (standard `URLSearchParams` returned) |
| `ServerInsertedHTMLContext` | React context                  | —                                                             | Not shimmed                                       |
| `useServerInsertedHTML`     | Hook                           | —                                                             | Not shimmed                                       |

**Divergences:**

- `useRouter().replace()` uses `replaceState` (replaces the current history entry, matching Next.js behavior).
- `redirect()` does not accept a `RedirectType` second argument. timber always uses replace semantics for redirects. The `RedirectType` const is exported for type compatibility but ignored at runtime.
- `useSearchParams()` returns standard `URLSearchParams`, not Next.js's `ReadonlyURLSearchParams` that throws on mutation. Mutation of the returned object doesn't affect the URL.
- `permanentRedirect(path)` delegates to `redirect(path, 308)`. Unlike Next.js, it does not accept a `RedirectType` argument.
- `useSelectedLayoutSegment`/`useSelectedLayoutSegments` derive the selected segment from URL pathname + layout depth context. The `parallelRouteKey` argument is accepted for API compatibility but currently unused (parallel route segment tracking is not yet implemented).

### `next/headers`

| Export      | Next.js                                   | timber                                | Status      |
| ----------- | ----------------------------------------- | ------------------------------------- | ----------- |
| `headers`   | Async function → `ReadonlyHeaders`        | ALS-backed, returns read-only Headers | Shimmed     |
| `cookies`   | Async function → `ReadonlyRequestCookies` | ALS-backed, returns `RequestCookies`  | Shimmed     |
| `draftMode` | Async function → `DraftMode`              | —                                     | Not shimmed |

**Divergences:** `headers()` returns the standard `Headers` object (read-only by convention), not Next.js's `ReadonlyHeaders` wrapper. `cookies()` returns a `RequestCookies` object with `.get()`, `.has()`, `.getAll()` — read-only, unlike Next.js's `ReadonlyRequestCookies` which also has `.set()` and `.delete()`. Both throw outside a request context. `draftMode` is not implemented and not planned.

### `next/font/google`

| Export                                  | Next.js              | timber           | Status                           |
| --------------------------------------- | -------------------- | ---------------- | -------------------------------- |
| Per-font functions (Inter, Roboto, ...) | Build-time transform | —                | Handled by `timber-fonts` plugin |
| Default export                          | —                    | Stub font loader | Shimmed (stub)                   |

**Divergences:** Next.js's `next/font/google` is a build-time transform, not a runtime module. The shim provides a stub default export that returns empty `className`/`style` values so import resolution succeeds. Real font handling is implemented in the `timber-fonts` Vite plugin, which intercepts font imports at build time.

---

## Ecosystem Library Compatibility

### nuqs

**Status: Compatible** (after this audit)

nuqs imports from `next/navigation.js`:

- `useRouter` — calls `router.replace(url, { scroll: false })` for URL updates
- `useSearchParams` — reads current search params

Both are now shimmed. `useRouter().replace()` uses `replaceState`, so nuqs URL updates do not add history entries.

### next-themes

**Status: Compatible**

next-themes does not import from any `next/*` module in its library source. It is a pure React implementation using only `react` imports. No shims needed.

### next-intl

**Status: Partially compatible** (audited)

next-intl has five entry points with different `next/*` dependencies:

| Entry point            | `next/*` imports                                  | timber status                                  |
| ---------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `next-intl` (root)     | None — uses `use-intl` + `react` only             | **Compatible**                                 |
| `next-intl/navigation` | `useRouter`, `usePathname` from `next/navigation` | **Compatible** (shimmed)                       |
|                        | `next/link` default import                        | **Compatible** (shimmed)                       |
|                        | `redirect` from `next/navigation`                 | **Compatible** (shimmed)                       |
|                        | `permanentRedirect` from `next/navigation`        | **Compatible** (shimmed)                       |
| `next-intl/server`     | `headers` from `next/headers`                     | **Compatible** (ALS-backed)                    |
| `next-intl/middleware` | `NextResponse` from `next/server`                 | **Not compatible** — `next/server` not shimmed |
| `next-intl/plugin`     | `next/package.json` (version check)               | **Not applicable** — Next.js build plugin      |

**Summary:** Core i18n (`useTranslations`, `useFormatter`, `useLocale`, `NextIntlClientProvider`) works out of the box. The navigation integration (`createNavigation`) works — `Link`, `usePathname`, `useRouter`, `redirect`, and `permanentRedirect` are all shimmed. The server integration requires `headers()` which timber intentionally does not provide (use explicit context passing instead). The middleware is N/A since timber uses `proxy.ts`.

**Recommended usage in timber:**

- Use `next-intl` root export + `NextIntlClientProvider` for translations — works today
- Use `next-intl/navigation` for `Link`, `useRouter`, `redirect`, and `permanentRedirect` — fully shimmed
- Use `next-intl/server` for server-side locale detection — `headers()` is now ALS-backed
- Do not use `next-intl/middleware` or `next-intl/plugin` — these are Next.js-specific

---

## Poison Pill Packages

timber supports the `server-only` and `client-only` npm packages natively via environment-aware virtual modules in the `timber-shims` plugin. No npm install required — the shims plugin intercepts these imports at resolution time.

| Package       | Correct Environment            | Wrong Environment                 |
| ------------- | ------------------------------ | --------------------------------- |
| `server-only` | rsc, ssr → no-op (`export {}`) | client → `throw new Error(...)`   |
| `client-only` | client → no-op (`export {}`)   | rsc, ssr → `throw new Error(...)` |

The error messages match the Next.js ecosystem convention so that developers see familiar diagnostics.

---

## Not Shimmed (Intentional)

These Next.js modules are **not shimmed** and will produce import errors:

| Module            | Reason                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------- |
| `next/router`     | Pages Router only — timber is App Router only                                          |
| `next/head`       | Pages Router only — use `metadata` export or `generateMetadata`                        |
| `next/script`     | Not yet implemented                                                                    |
| `next/dynamic`    | Use React.lazy() + Suspense                                                            |
| `next/server`     | Internal Next.js server utilities — no equivalent needed                               |
| `next/cache`      | Use `@timber/app/cache` (`timber.cache()`)                                             |
| `next/font/local` | Shimmed via `@timber/fonts/local` — resolved by `timber-shims` + `timber-fonts` plugin |

Libraries that depend on Next.js build plugins (SWC transforms, webpack plugins) or internal APIs cannot be shimmed and require custom integration.
