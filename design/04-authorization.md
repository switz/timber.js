# Authorization

## `access.ts` — Per-Segment Auth

Authentication and authorization live in `access.ts` files co-located with route segments. Each segment that requires auth has its own `access.ts`. Auth runs **inside the React tree** — the framework injects an `AccessGate` async server component above each segment's layout. `AccessGate` calls the segment's `access.ts` before the layout renders.

```typescript
// app/(authenticated)/access.ts
import type { AccessContext } from '@timber/app/server';
import { cookies, redirect } from '@timber/app/server';

export default async function access(ctx: AccessContext) {
  const session = getSessionFromCookie(cookies());
  if (!session) redirect('/login');
  // Fetch user and orgs — this warms the cache for the layout below
  await getUser(session.userId);
  await db.organizations.findByUser(session.userId);
}
```

`access.ts` is a pure gate — it passes or fails. Return values are discarded. The layout gets the same data by calling the same cached functions — `React.cache` deduplicates within the same render pass:

```typescript
// app/(authenticated)/layout.tsx
import { getUser, getUserOrgs } from '@/lib/auth'

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()      // cache HIT — AccessGate already resolved this
  const orgs = await getUserOrgs()  // cache HIT

  return (
    <div>
      <aside>
        <span>{user.name}</span>
        <span>{orgs[0]?.name}</span>
      </aside>
      <main>{children}</main>
    </div>
  )
}
```

Deeper segments can have their own `access.ts` for additional checks:

```typescript
// app/(authenticated)/dashboard/workspace/projects/[projectId]/access.ts
export default async function access(ctx: AccessContext) {
  await requireUser(); // cache HIT — parent segment's AccessGate already resolved this
  const project = await getProject(ctx.params.projectId);
  if (!project) deny(404);
  if (project.orgId !== (await requireUser()).orgId) deny(); // default 403
}
```

## Pre-Render Pass and Verdict Replay

Access checks run in two phases:

1. **Pre-render pass** (route-element-builder.ts) — runs every `access.ts` eagerly, top-down, before building the React element tree. Verdicts (`'pass'` or a `DenySignal`/`RedirectSignal`) are stored in a local map keyed by segment index. OTEL spans are emitted here. If any check denies or redirects, the framework can render deny pages inside the layout shell with the correct HTTP status code.

2. **In-tree AccessGate** — receives the stored verdict as a prop and replays it synchronously. On `'pass'`, it renders children. On `DenySignal`/`RedirectSignal`, it throws synchronously — no async, no re-execution.

This deduplication ensures:
- `access.ts` executes exactly once per segment per request
- Verdicts are immune to Suspense timing — they throw synchronously during render, before `onShellReady`
- `React.cache` populated during the pre-render pass is available during render (same ALS scope)
- Slot access (`SlotAccessGate`) is unaffected — slots aren't in the pre-render pass and continue to call `accessFn` directly

When no verdict is provided (backward compat with `tree-builder.ts`), AccessGate falls back to calling `accessFn` with OTEL instrumentation.

## Why Auth Lives in `AccessGate`

Two reasons:

1. **Shared `React.cache` scope.** Because `AccessGate` runs inside the same `renderToReadableStream` call as layouts and pages, all access checks and all components share one `React.cache` scope. A `requireUser()` call in the root `AccessGate` populates the cache; the same call in any deeper `AccessGate` or layout is a free hit. No separate cache layer needed.

2. **Separation of concerns.** `AccessGate` is a separate component from the layout in the element tree, so it always executes regardless of any future layout caching optimizations. Auth and rendering are decoupled.

## `AccessContext`

There is a single `AccessContext` type used for both segment access and slot access. The framework handles the behavioral difference at runtime — `deny()` produces an HTTP status in segment context and graceful degradation in slot context. No separate `SegmentAccessContext` / `SlotAccessContext` split.

```typescript
interface AccessContext {
  params: Record<string, string>;
  searchParams: T; // parsed & typed when search-params.ts exists; URLSearchParams otherwise
}
```

`AccessContext` does **not** include `cookies` or `headers`. Those are imported directly from `@timber/app/server` — they are ALS-backed and work the same way in `access.ts` as everywhere else in server code:

```typescript
import { cookies, headers } from '@timber/app/server';

export default async function access(ctx: AccessContext) {
  const session = getSessionFromCookie(cookies()); // imported, not ctx.cookies
  if (!session) redirect('/login');
}
```

This is intentional — `cookies()` and `headers()` are universal server primitives, not context-specific ones. Putting them on `ctx` would suggest they are scoped differently than they are.

Same as `MiddlewareContext`: when a `search-params.ts` exists for the route, `ctx.searchParams` is the parsed, typed object. The framework runs the definition's `.parse()` before calling `access()`. Build-time codegen types the generic per-route.

**Non-leaf `access.ts` searchParams typing:** A parent segment's `access.ts` (e.g., `(authenticated)/access.ts`) can guard many leaf routes, each with different `search-params.ts` definitions. In this case, `ctx.searchParams` is typed as a **union of all possible leaf searchParams types** for routes under that segment. If the parent needs to read a specific param, it must narrow the type. In practice, parent access files rarely read searchParams — they focus on auth. Leaf access files get the exact leaf type.

## Each `access.ts` Is Independent

There is no `parentAccess` or cascading. Each `access.ts` is fully self-contained. If multiple segments need the user object, they each call `requireUser()` — `React.cache` deduplicates within the same render pass:

```typescript
// (authenticated)/access.ts
export default async function access(ctx: AccessContext) {
  await requireUser(); // first call — executes (or timber.cache HIT)
}

// dashboard/workspace/access.ts
export default async function access(ctx: AccessContext) {
  const user = await requireUser(); // cache HIT → no DB
  const workspace = await getWorkspace(ctx.params.workspaceId);
  if (!workspace.members.includes(user.id)) deny();
}
```

React renders the tree top-down: the parent `AccessGate` runs first, populating `React.cache`. The child `AccessGate` gets a cache hit. No data dependency, no coupling between access files.

## Composable Auth Functions

Auth functions live in `lib/auth.ts` and are called from `access.ts`:

```typescript
// lib/auth.ts
export const getUser = timber.cache(
  async (userId: string) => {
    return await db.users.findUnique({ where: { id: userId } });
  },
  { ttl: 60, tags: (userId) => [`user:${userId}`] }
);

export async function requireUser() {
  const session = getSessionFromCookie(cookies());
  if (!session) redirect('/login');
  return await getUser(session.userId);
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'admin') deny(); // default 403
  return user;
}
```

These functions are unchanged from the composable auth pattern. The difference is where they are called: `access.ts` instead of inside layouts or pages.

## Why This Is Performant

With `React.cache` deduplication and middleware.ts prefetching, auth checks add minimal overhead:

```
Request for /dashboard/workspace/projects/123 (5 segments):

middleware.ts fires prefetches at t=0:
  void requireUser()                            → timber.cache MISS → DB query
  void getWorkspace(workspaceId)                → timber.cache MISS → DB query
  void getProject(projectId)                    → timber.cache MISS → DB query

React renders top-down:
  AccessGate(root): no access.ts                 0ms
  AccessGate(auth): requireUser()                → timber.cache HIT (handler warmed it)
  AuthLayout: getUser()                          → timber.cache HIT
  AccessGate(workspace): requireUser() (HIT) + getWorkspace() (HIT)
  AccessGate(project): requireUser() (HIT) + getProject() (HIT)

All auth data already resolved by middleware.ts. Access checks are essentially free.
```

Without middleware.ts prefetching, `React.cache` deduplicates shared calls within the render pass (e.g., `requireUser()` executes once, all subsequent calls hit `React.cache`), and `timber.cache` deduplicates across requests. Unrelated fetches waterfall through the top-down render.

## Route Structure Should Mirror Auth Boundaries

If a page is public, it should not live under a segment with an `access.ts` that requires auth. Route your public pages under public segments:

```
app/
  (public)/                  ← no access.ts
    invite/[token]/page.tsx  ← public page
    docs/page.tsx            ← public page
  (authenticated)/           ← access.ts calls requireUser()
    access.ts
    dashboard/page.tsx       ← auth enforced by segment's access.ts
    settings/page.tsx        ← auth enforced by segment's access.ts
```

There is no `skipParentAccess` or override mechanism. If you need weaker auth for a child route, it belongs in a different segment. This is a routing design decision, not a framework limitation.

## Slot-Level Auth

Parallel slots (`@slot` directories) can have their own `access.ts` for slot-specific authorization. Slot access is different from segment access in one critical way: **failure is graceful degradation, not page failure.** A denied slot shows `denied.tsx` (or `default.tsx`, or nothing). The page, parent layout, and sibling slots are unaffected.

This preserves the principle that route structure mirrors auth boundaries — segments define hard auth gates. Slots add optional, soft auth for content regions within a layout.

Slot access uses the same `deny()` function as segment access — the framework handles the behavioral difference. In a segment, `deny()` produces an HTTP status code. In a slot, `deny()` triggers graceful degradation to `denied.tsx`. `redirect()` is not available in slot access (dev-mode error). See the [Rendering Pipeline](02-rendering-pipeline.md#slot-access-failure--graceful-degradation) for the full mechanics.

## `access.ts` Runs on Every Navigation

`access.ts` runs on every RSC navigation — initial page loads and client-side navigations. A session that expires between navigations produces a correct redirect when the `AccessGate` executes during rendering. Because timber.js holds the flush until `onShellReady`, the redirect produces a correct HTTP 302.

## Security Notes

### `redirect()` in `access.ts`

`redirect()` is restricted to relative paths — same as in server actions. `redirect('/login')` is correct. `redirect('https://evil.com')` is rejected. See [Forms & Server Actions — Security](08-forms-and-actions.md#security) for the full redirect safety model.

### `X-Timber-State-Tree` Is Not a Security Boundary

The client sends its mounted segment tree as a performance hint for layout skip optimization (see [Routing — Segment Tree Diffing](07-routing.md#segment-tree-diffing-on-navigation)). This header is **not a security boundary.** Manipulating it can only cause extra rendering work or stale layouts — never auth bypass. All `access.ts` files in the segment chain execute on every navigation regardless of the state tree content. A fabricated state tree claiming segments are mounted does not skip access checks.

## Auth in API Routes (`route.ts`)

`access.ts` runs for API routes, but outside a React render pass — there is no `AccessGate` component and `React.cache` is not active. This means auth functions that rely on `React.cache` for deduplication will not dedup in API route context. Each call executes independently.

For auth functions that need to work seamlessly across page routes, API routes, and `middleware.ts`, use `timber.cache` instead of `React.cache`. `timber.cache`'s cacheHandler provides inherent dedup regardless of whether a React render pass is active.

```typescript
// lib/auth.ts — works in all contexts
export const getUser = timber.cache(async (userId: string) => db.users.find(userId), {
  ttl: 60,
  tags: (id) => [`user:${id}`],
});

// This works in page routes (React.cache available), API routes (no React.cache),
// and middleware.ts (no React.cache) — timber.cache handles dedup in all cases.
```

## Auth in Server Actions

Server actions use `createActionClient` middleware, not `access.ts`. See [Forms & Server Actions](08-forms-and-actions.md).
