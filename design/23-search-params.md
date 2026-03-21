# Search Params

## Overview

Every route can declare typed search params via a co-located `search-params.ts` file. The framework auto-parses them on the server (in `page.tsx`, `middleware.ts`, `access.ts`), syncs them on the client via `useQueryStates`, and enforces static analyzability at build time so the generated route map carries full type information.

The system has four layers:

1. **Codec protocol** — `SearchParamCodec<T>` with `parse` / `serialize`. nuqs parsers, Zod schemas (via `fromSchema`), and custom codecs all satisfy it. See [09-typescript.md](09-typescript.md) §"The SearchParamCodec Protocol" for the full spec.
2. **Definition** — `createSearchParams()` returns a `SearchParamsDefinition<T>` with composition (`.extend()`, `.pick()`), serialization (`.serialize()`, `.href()`, `.toSearchParams()`), and URL key aliasing.
3. **Server integration** — ALS-backed `searchParams()` auto-parses in page/middleware/access contexts. Nested components use `.parse()` explicitly.
4. **Client integration** — `useQueryStates` hook backed by nuqs, with `shallow: false` default triggering RSC navigation on param changes.

---

## nuqs Integration

### Why nuqs

`useQueryStates` delegates to [nuqs](https://nuqs.47ng.com/) for URL synchronization. nuqs handles the hard parts — batched updates, React 19 `startTransition` integration, throttled URL writes, `pushState`/`replaceState` management, and cross-tab sync. Reimplementing these correctly is error-prone and unnecessary.

nuqs is a **required peer dependency**. Apps that use `useQueryStates` must install it. Apps that only use server-side `searchParams()` do not need it.

```json
// @timber-js/app package.json
{
  "peerDependencies": {
    "nuqs": "^2.0.0"
  }
}
```

### Custom Adapter

nuqs supports framework adapters (Next.js, React Router, Remix, etc.). timber provides its own adapter that connects nuqs's URL update mechanism to timber's RSC router.

```tsx
// packages/timber-app/src/client/nuqs-adapter.tsx
'use client';

// Implements nuqs's UseAdapterHook interface
// Returns { searchParams, updateUrl } conforming to AdapterInterface
```

**Adapter behavior:**

| nuqs calls `updateUrl(search, options)` | Adapter action                                                              |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `options.shallow === true`              | `pushState`/`replaceState` only — no server roundtrip                       |
| `options.shallow === false` (default)   | Update URL + call `getRouter().navigate(newUrl)` to fetch fresh RSC payload |
| `options.history === 'push'`            | `history.pushState`                                                         |
| `options.history === 'replace'`         | `history.replaceState`                                                      |
| `options.scroll === true`               | `window.scrollTo(0, 0)` after update                                        |

**Default options** (override nuqs defaults):

```ts
{
  shallow: false,      // timber default: search param changes trigger server navigation
  scroll: true,        // scroll to top on param change
  history: 'push',     // add history entry
  clearOnDefault: true // omit params that match their default value
}
```

### Auto-Injection

The adapter is automatically injected in `browser-entry.ts` — it wraps the hydrated React tree. No user setup required:

```ts
// browser-entry.ts (simplified)
hydrateRoot(document, <TimberNuqsAdapter>{element}</TimberNuqsAdapter>)
```

### Codec Bridge

nuqs parsers and timber's `SearchParamCodec` are close but not identical. The bridge wraps each codec as a nuqs-compatible parser:

```ts
function bridgeCodec<T>(codec: SearchParamCodec<T>) {
  return {
    parse: (v: string) => codec.parse(v),
    serialize: (v: T) => codec.serialize(v) ?? '',
    defaultValue: codec.parse(undefined),
    eq: (a: T, b: T) => codec.serialize(a) === codec.serialize(b),
  };
}
```

nuqs parsers (`parseAsInteger`, `parseAsString`, etc.) are valid `SearchParamCodec` values natively — no bridge needed in that direction.

---

## Route-Scoped `useQueryStates<'/route'>()`

### Problem

Today, client components must import a route's `search-params.ts` explicitly:

```tsx
import searchParamsDef from '@/app/products/search-params';
const [params, setParams] = searchParamsDef.useQueryStates();
```

This works but requires the component to know the file path of the definition. For components rendered under a known route, a generic approach is more ergonomic.

### API

```tsx
'use client';
import { useQueryStates } from '@timber-js/app/client';

export function ProductFilters() {
  // Route string provides full type narrowing
  const [{ page, category, sort }, setParams] = useQueryStates<'/products'>('/products');
  // page: number, category: string | null, sort: 'price-asc' | ...
}
```

The route string is both a type parameter (for narrowing) and a runtime argument (for codec resolution).

### Type-Level: Codegen Overloads

The build-time codegen already emits a `Routes` type map with `searchParams` per route. We extend it to emit `useQueryStates` overloads in the `@timber-js/app/client` module augmentation — the same pattern used for `useParams`:

```typescript
// Generated by codegen
declare module '@timber-js/app/client' {
  export function useQueryStates<R extends '/products'>(
    route: R, options?: QueryStatesOptions
  ): [{ page: number; category: string | null; sort: SortOption }, SetParams<...>]

  export function useQueryStates<R extends '/dashboard'>(
    route: R, options?: QueryStatesOptions
  ): [{}, SetParams<{}>]

  // Fallback: standalone codecs (existing API)
  export function useQueryStates<T extends Record<string, unknown>>(
    codecs: { [K in keyof T]: SearchParamCodec<T[K]> },
    options?: QueryStatesOptions
  ): [T, SetParams<T>]
}
```

Routes without a `search-params.ts` get an overload returning `[{}, SetParams<{}>]`.

### Runtime: Registration at Route Load

When a route's modules load (during initial page load or client navigation), the framework registers its `search-params.ts` default export into a runtime `Map<string, SearchParamsDefinition>`:

```ts
// search-params/registry.ts
const registry = new Map<string, SearchParamsDefinition<any>>();

export function registerSearchParams(route: string, def: SearchParamsDefinition<any>) {
  registry.set(route, def);
}

export function getSearchParams(route: string): SearchParamsDefinition<any> | undefined {
  return registry.get(route);
}
```

Registration happens in the route manifest loader. The manifest generation in `plugins/routing.ts` is extended to import and register `search-params.ts` modules alongside page modules:

```ts
// Generated manifest (simplified)
{
  path: '/products',
  page: () => import('./products/page.tsx'),
  searchParams: () => import('./products/search-params.ts'),
}
```

When the route loads, the framework calls `registerSearchParams('/products', definition)` before rendering.

**Tree-shakeability:** Only routes the user actually visits have their codecs loaded. The lazy `() => import(...)` pattern ensures code-splitting at the route level.

**Cross-route usage:** A component under `/dashboard` calling `useQueryStates<'/products'>('/products')` will fail at runtime if `/products` hasn't been visited. For cross-route usage, import the definition explicitly — that's the existing pattern and is fully supported.

### File Watcher

`search-params` is added to `ROUTE_FILE_PATTERNS` in `plugins/routing.ts` so that adding, removing, or modifying a `search-params.ts` file triggers manifest regeneration and codegen type updates in dev.

---

## Composable Patterns

Shared search param bases live in normal modules (not `search-params.ts` route files). Routes compose them via `.extend()` and `.pick()`.

### Pagination

```typescript
// lib/search-params/pagination.ts
import { createSearchParams, fromSchema } from '@timber-js/app/search-params';
import { z } from 'zod/v4';

export const pagination = createSearchParams({
  page: fromSchema(z.coerce.number().int().min(1).default(1)),
  pageSize: fromSchema(z.coerce.number().int().min(1).max(100).default(20)),
});
```

### Searchable

```typescript
// lib/search-params/searchable.ts
import { createSearchParams, fromSchema } from '@timber-js/app/search-params';
import { z } from 'zod/v4';

export const searchable = createSearchParams({
  q: fromSchema(z.string().nullable().default(null)),
});
```

### Sortable

```typescript
// lib/search-params/sortable.ts
import { createSearchParams } from '@timber-js/app/search-params';

type SortDir = 'asc' | 'desc';

export const sortable = createSearchParams({
  sortBy: {
    parse: (v) => (typeof v === 'string' ? v : null),
    serialize: (v) => v,
  },
  sortDir: {
    parse: (v) => (v === 'asc' || v === 'desc' ? v : ('asc' as SortDir)),
    serialize: (v) => v,
  },
});
```

### Route Composition

```typescript
// app/products/search-params.ts
import { pagination } from '@/lib/search-params/pagination';
import { searchable } from '@/lib/search-params/searchable';
import { fromSchema } from '@timber-js/app/search-params';
import { z } from 'zod/v4';

export default pagination.extend(searchable.codecs).extend(
  {
    category: fromSchema(z.string().nullable().default(null)),
    sort: {
      parse: (v) => {
        const valid = ['price-asc', 'price-desc', 'newest', 'popular'] as const;
        return valid.includes(v as any) ? (v as (typeof valid)[number]) : 'popular';
      },
      serialize: (v) => v,
    },
  },
  {
    urlKeys: { q: 'search', category: 'cat' },
  }
);
// Type: { page: number; pageSize: number; q: string | null; category: string | null; sort: ... }
```

### Client `.pick()` for Focused Components

```typescript
// app/products/product-filters.tsx
'use client';
import searchParamsDef from './search-params';

const filterParams = searchParamsDef.pick('category', 'sort', 'q');

export function ProductFilters() {
  const [{ category, sort, q }, setParams] = filterParams.useQueryStates();
  // setParams only accepts { category?, sort?, q? } — page/pageSize not exposed
}
```

### Rules

- `.extend()` with a key collision is a TypeScript error. To override: `.pick()` to exclude, then `.extend()` to add the replacement.
- `.codecs` accessor returns raw codecs — **aliases are NOT carried**. This is intentional: codecs are reusable logic, aliases are route-level URL decisions.
- Shared bases are normal modules, not route files. Only `search-params.ts` co-located with `page.tsx` is scanned by the framework.
- Chaining `.extend().extend()` is fine — each call returns a new immutable definition.

---

## URL Key Aliasing

URL key aliasing maps TypeScript property names to different URL query parameter keys. Keeps code descriptive while URLs stay short.

```typescript
export default createSearchParams(
  {
    search: fromSchema(z.string().nullable().default(null)),
    itemsPerPage: fromSchema(z.coerce.number().int().default(20)),
  },
  {
    urlKeys: { search: 'q', itemsPerPage: 'limit' },
  }
);
// ?q=shoes&limit=50 → { search: 'shoes', itemsPerPage: 50 }
```

The `urlKeys` map is exposed as a read-only accessor on `SearchParamsDefinition` so the nuqs bridge can pass it through:

```typescript
definition.urlKeys; // { search: 'q', itemsPerPage: 'limit' }
```

Aliasing rules:

- `.extend()` does not inherit aliases from the base — set `urlKeys` in the second argument
- `.pick()` preserves aliases for the picked keys
- URL key collisions (two props → same URL key) are a TypeScript error
- `urlKeys` must be a static object literal — dynamic values produce a build error

---

## Server Integration

Auto-parsing uses the ALS (AsyncLocalStorage) store populated at the request boundary. See [09-typescript.md](09-typescript.md) §"Mechanism" for details.

**Auto-parsed contexts:** `page.tsx`, `middleware.ts`, `access.ts` — the framework runs the route's `search-params.ts` definition's `.parse()` and stores the result.

**Outside auto-parsed contexts:** Nested server components get raw `URLSearchParams` from `searchParams()`. Import the definition and call `.parse()` explicitly.

**Which definition applies:** The leaf route's `search-params.ts` is canonical. Middleware always gets the leaf's parsed searchParams. Access checks in all segments receive the leaf's parsed searchParams (same URL, same query string).

---

## Static Analyzability

`search-params.ts` files must be statically analyzable. The build extracts `T` from `SearchParamsDefinition<T>` using TypeScript's type parameter — not by executing the file.

**Allowed patterns:**

- `createSearchParams()` call
- `.extend()` chain on a `SearchParamsDefinition`
- `.pick()` chain on a `SearchParamsDefinition`

**Disallowed patterns:**

- Arbitrary factory functions
- Runtime conditionals (ternaries, `if` blocks)
- Opaque variable references

**On violation:** Hard build error with file path, the offending expression, and a suggestion for how to make it static. Not a warning — types do not fall back to `unknown`.

See [09-typescript.md](09-typescript.md) §"Static Analyzability" and `analyzeSearchParams()` in `search-params/analyze.ts` for implementation details.

---

## `shallow: false` — The Key Design Decision

This is a deliberate departure from nuqs's default. In timber.js, search params drive server-side data fetching. Changing `?page=2` triggers a server navigation to get fresh RSC data. `shallow: true` is opt-in for purely client-side state (toggling a UI panel, switching tabs without data).

```typescript
// Default: server navigation (fetch fresh data)
setParams({ page: 2 });

// Opt-in: client-only URL update
setParams({ tab: 'settings' }, { shallow: true });
```

This integrates with `useNavigationPending()` — the hook returns `true` while the RSC fetch is in flight, enabling loading indicators on param changes.

---

## API Surface Audit (2026-03-17)

Audit of the search params API comparing timber's surface against nuqs and identifying gaps for future work.

### Public Exports

**`@timber-js/app/search-params`:**

| Export                      | Kind          | Purpose                                                       |
| --------------------------- | ------------- | ------------------------------------------------------------- |
| `createSearchParams`        | factory       | Build a `SearchParamsDefinition<T>` from codecs               |
| `fromSchema`                | codec bridge  | Standard Schema (Zod, Valibot, ArkType) → `SearchParamCodec`  |
| `fromArraySchema`           | codec bridge  | Standard Schema for array-valued params                       |
| `registerSearchParams`      | registry      | Route-scoped registration (internal)                          |
| `getSearchParams`           | registry      | Route-scoped lookup (internal)                                |
| `parseAsString`             | codec         | String codec, returns `string \| null`                        |
| `parseAsInteger`            | codec         | Integer codec, returns `number \| null`                       |
| `parseAsFloat`              | codec         | Float codec, returns `number \| null`                         |
| `parseAsBoolean`            | codec         | Boolean codec (`true/1/false/0`), returns `boolean \| null`   |
| `parseAsStringEnum`         | codec factory | String enum codec from allowed values list                    |
| `parseAsStringLiteral`      | codec factory | String literal codec from `as const` tuple                    |
| `withDefault`               | codec wrapper | Replaces null with a default value, makes output non-nullable |
| `analyzeSearchParams`       | build-time    | Static analysis of `search-params.ts` files                   |
| `SearchParamCodec<T>`       | type          | Codec protocol: `parse` + `serialize`                         |
| `InferCodec<C>`             | type          | Extract `T` from a codec                                      |
| `SearchParamsDefinition<T>` | type          | Full definition with parse/serialize/compose/hook             |
| `SetParams<T>`              | type          | Setter function signature                                     |
| `SetParamsOptions`          | type          | Options for setter (shallow, scroll, history)                 |
| `QueryStatesOptions`        | type          | Options for `useQueryStates` hook                             |
| `SearchParamsOptions`       | type          | Options for `createSearchParams` (urlKeys)                    |

**`@timber-js/app/client` (search-params related):**

| Export               | Kind     | Purpose                                                      |
| -------------------- | -------- | ------------------------------------------------------------ |
| `useSearchParams`    | hook     | Raw `URLSearchParams` (Next.js compat)                       |
| `useQueryStates`     | hook     | Typed, codec-backed URL params                               |
| `bindUseQueryStates` | internal | Binding helper for `SearchParamsDefinition.useQueryStates()` |

### Identified Gaps

1. ~~**No built-in codecs**~~ **Resolved (TIM-362).** timber now ships `parseAsString`, `parseAsInteger`, `parseAsFloat`, `parseAsBoolean`, `parseAsStringEnum`, `parseAsStringLiteral`, and `withDefault()` in `@timber-js/app/search-params`. These are zero-dependency codecs covering the most common use cases. nuqs parsers remain compatible for advanced cases (dates, JSON, arrays).

2. **No `defaultValue` on `SearchParamCodec`** — nuqs exposes `defaultValue` explicitly via `.withDefault()`. timber derives defaults implicitly via `parse(undefined)`. An optional `defaultValue` property on the codec protocol would enable introspection without calling `parse(undefined)`.

3. **No `.defaults` accessor on `SearchParamsDefinition`** — `defaultSerialized` is computed internally for URL omission but parsed defaults are never exposed. A `.defaults` accessor returning `T` would be useful for SSR fallbacks, placeholder UI, and reset-to-defaults.

4. **No `useQueryState` (singular)** — nuqs exports both `useQueryState` (single param) and `useQueryStates` (multi-param). timber only has `useQueryStates`. The singular form is more natural for single-param use cases.

5. **Codec error handling undocumented** — `fromSchema` silently falls back to default on parse failure. The "return default, don't throw" convention exists but is buried in prose. No validation mode for surfacing parse errors in dev.

6. **`CodecMap<T>` not exported** — Defined but not in the public API. Useful for library authors building reusable codec maps.
