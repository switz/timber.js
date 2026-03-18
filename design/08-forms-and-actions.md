# Forms & Server Actions

## Mutation and Revalidation

After a server action mutates data, there are three tools:

### `redirect()`

Use when the user should land somewhere new. The action calls `redirect('/success')`, which triggers a navigation. The client runs the full waterfall for the new route.

```typescript
'use server';
export async function createProject(formData: FormData) {
  const project = await db.projects.create(formData);
  redirect(`/projects/${project.id}`);
}
```

### `useOptimistic`

Use when the action's return value is sufficient to update the UI. The client updates immediately; the action confirms. Standard React 19 pattern. No framework involvement.

### `revalidatePath(path)`

Use when parts of the current page need to reflect new server state without a URL change. The action calls `revalidatePath(path)` on the server, which re-runs the handler + access checks + render for that path and returns the RSC flight payload as part of the action response. The client receives the action response, detects the RSC payload, and reconciles.

```typescript
'use server';
export async function toggleTodo(id: string) {
  await db.todos.toggle(id);
  return revalidatePath('/dashboard'); // returns RSC flight for /dashboard
}
```

No SSE. No WebSocket. No separate request. The RSC payload piggybacks on the existing action response channel. The client action handler detects the payload type and reconciles.

The action response carries both the action result and the revalidated tree in a single RSC stream. See §"Single-Roundtrip Revalidation" below for the wire format.

---

## Middleware for Server Actions

`middleware.ts` does not run for server actions. Actions use an explicit typed middleware API — `createActionClient` — that declares auth, validation, and other cross-cutting concerns before the action body executes. This is a first-party primitive inspired by `next-safe-action`.

```typescript
// lib/action.ts — define your action clients once, reuse across the app
import { createActionClient, ActionError } from '@timber-js/app/server';
import { getUser } from '@/lib/auth';

export const action = createActionClient({
  middleware: async () => {
    const user = await getUser();
    if (!user) throw new ActionError('UNAUTHORIZED');
    return { user }; // merged into ctx in the action body
  },
});

export const adminAction = createActionClient({
  middleware: async () => {
    const user = await getUser();
    if (!user) throw new ActionError('UNAUTHORIZED');
    if (!user.isAdmin) throw new ActionError('FORBIDDEN');
    return { user };
  },
});
```

```typescript
// app/todos/actions.ts
'use server';
import { z } from 'zod/v4';
import { action } from '@/lib/action';

export const createTodo = action
  .schema(z.object({ title: z.string().min(1) }))
  .action(async ({ input, ctx }) => {
    await db.todos.create({ ...input, userId: ctx.user.id });
    return revalidatePath('/todos');
  });
```

```tsx
// app/todos/new-todo-form.tsx
'use client';
import { useActionState } from '@timber-js/app/client';
import { createTodo } from './actions';

export function NewTodoForm() {
  const [result, action, isPending] = useActionState(createTodo, null);

  return (
    <form action={action}>
      <input name="title" />
      {result?.validationErrors?.title && <p>{result.validationErrors.title}</p>}
      <button disabled={isPending}>Add</button>
    </form>
  );
}
```

`@timber-js/app/client` exports a typed `useActionState` that understands the action builder's result shape. `result` is typed to `{ data: Awaited<ReturnType> } | { validationErrors: SchemaErrors } | { serverError: { code: string; data?: Record<string, unknown> } } | null` — no casting, no `any`. The action builder emits a function that satisfies both the direct call signature and React's `(prevState, formData) => Promise<State>` contract, so it passes to `useActionState` without wrapping.

`createActionClient` creates a typed action builder. `.schema()` declares the input schema — any library implementing the [Standard Schema](https://github.com/standard-schema/standard-schema) protocol (Zod ≥3.24, Valibot ≥1.0, ArkType). Legacy schemas with `.parse()` / `.safeParse()` are also accepted for backward compatibility. `.action()` receives the validated `input` and the middleware `ctx`. If middleware throws an `ActionError`, the action short-circuits and the error is returned to the client as a typed value.

Multiple middleware layers can be composed:

```typescript
export const billedAction = createActionClient({
  middleware: [authMiddleware, billingMiddleware],
});
```

Each middleware in the array runs sequentially. Their return values are merged and available as `ctx`.

## `ActionError`

`ActionError` is the typed error class for server actions. It carries a string code and optional plain-data context.

```typescript
import { ActionError } from '@timber-js/app/server';

// In middleware:
throw new ActionError('UNAUTHORIZED');

// With data:
throw new ActionError('RATE_LIMITED', { retryAfter: 60 });
```

When an `ActionError` is thrown — from middleware or the action body — the action short-circuits and the client receives `result.serverError`:

```typescript
result.serverError;
// → { code: 'UNAUTHORIZED' }
// → { code: 'RATE_LIMITED', data: { retryAfter: 60 } }
```

When an unexpected error is thrown (not an `ActionError`), the framework catches it, logs it server-side with the full stack trace, and returns `{ code: 'INTERNAL_ERROR' }` to the client. No error details leak in production. In dev mode, `data.message` is included for debugging.

## `revalidatePath()` and `revalidateTag()`

Two distinct functions, no overloading:

- **`revalidatePath(path: string)`** — re-runs the handler and re-renders the route at that path. Returns the RSC flight payload for inline reconciliation. Used after mutations to refresh the current page without a navigation.
- **`revalidateTag(tag: string)`** — invalidates all pre-rendered shells and `'use cache'` entries tagged with that tag. Does not return a payload — the next request for an invalidated route re-renders fresh.

Both are callable from anywhere on the server — actions, API routes, handlers, background jobs, cron triggers. Not restricted to the action context.

**`revalidatePath` and short-circuits:** `revalidatePath(path)` re-runs the full handler and re-renders the route. If a handler short-circuits during revalidation (e.g., a feature flag redirect) or the page's auth check fails (e.g., session expired and `requireUser()` calls `redirect('/login')`), the action response includes the redirect instruction. The client follows it. This is a real scenario: a user's session can expire between page load and action submission. The framework handles it by returning the redirect as part of the action response, not by silently failing.

## The Basic Wire-Up (Without Middleware)

For actions that don't need auth or validation, a raw `'use server'` function works directly. The action client is opt-in, not required. However, `createActionClient` is the **recommended default** — it provides typed validation, middleware, and structured error handling. Raw `'use server'` exports are the escape hatch for simple cases.

```typescript
// app/todos/actions.ts
'use server';

export async function deleteTodo(id: string) {
  await db.todos.delete(id);
  return revalidatePath('/todos');
}
```

## Server Actions in Static Mode

In `static` output mode, there is no server to execute actions at request time. Server actions are extracted by the adapter and deployed as separate API endpoints (serverless functions or a standalone API server). The static site calls these endpoints via fetch.

**Limitations in static mode:**

- `revalidatePath()` cannot return an inline RSC payload — there is no server-side renderer to produce one. After the action completes, the client performs a separate navigation fetch to get fresh data (two roundtrips).
- The adapter must support split deployment (static assets + API functions). The Nitro adapter handles this for platforms like Vercel, Netlify, etc.
- `'use server'` is a build error in `static` + `noClientJavascript` mode — that mode ships zero JavaScript and cannot call server functions.

This is a known trade-off. Static mode prioritizes zero-server deployment for content sites. Apps with heavy mutation patterns should use `server` mode.

---

## Progressive Enhancement

Forms wired to server actions work without JavaScript. The `<form action={action}>` renders as a standard HTML form POST. The server action receives the `FormData`, executes, and responds. Navigation and revalidation work via standard HTTP redirects in the no-JS case.

`useActionState`, `useFormStatus`, and `useOptimistic` enhance the experience when JS is present — pending states, optimistic updates, inline validation errors. They gracefully degrade to standard form submission when JS is absent.

## Validation Pattern

`.schema()` accepts any schema library implementing the [Standard Schema](https://github.com/standard-schema/standard-schema) protocol (`~standard.validate`). This includes Zod ≥3.24, Valibot ≥1.0, and ArkType. Legacy schemas with `.parse()` / `.safeParse()` are also accepted. Validation errors are returned to the client as `result.validationErrors` — typed to the schema's shape. The action body only runs if validation passes.

**File uploads through schemas:** `parseFormData()` preserves `File` objects, so schemas can validate file fields using `z.instanceof(File)` (Zod), `v.instance(File)` (Valibot), or a custom Standard Schema check. Empty file inputs (no selection) are normalized to `undefined` before schema validation. `createActionClient` accepts an optional `fileSizeLimit` (in bytes) to reject oversized files before schema validation runs:

```typescript
const action = createActionClient({ fileSizeLimit: 5 * 1024 * 1024 }); // 5MB per file
```

---

## Client-Side Form Mechanics

### Form Submission Interception

React 19 wires `<form action={serverAction}>` on the client. The behavior differs based on JavaScript availability:

**With JavaScript (default):**

1. React intercepts the form `submit` event
2. `FormData` is serialized from the form fields
3. React sends a POST request to the RSC action endpoint with the serialized FormData
4. The server executes the action, serializes the result as an RSC payload
5. React receives the response and updates the UI via `useActionState` / transitions

**Without JavaScript (progressive enhancement):**

1. Standard HTML `<form>` submits via POST to the current URL
2. The server receives the `FormData` as a standard form POST
3. The server action executes
4. The server responds with an HTTP redirect (302) to the target page
5. The browser follows the redirect and renders the new page

### Single-Roundtrip Revalidation

When a server action calls `revalidatePath()`, the server builds the React element tree for that path and piggybacks it on the action response — no separate fetch needed.

**Wire format:** The server serializes a wrapper object through a single `renderToReadableStream` call:

```typescript
// When revalidatePath() was called:
renderToReadableStream({
  _action: actionResult, // the action's return value
  _tree: revalidatedElement, // React element tree for the revalidated path
});

// When revalidatePath() was NOT called:
renderToReadableStream(actionResult); // bare result, no wrapper
```

The client detects piggybacked responses via the `X-Timber-Revalidation: 1` response header. Head metadata (title, meta tags) is forwarded via `X-Timber-Head`.

**How it works:**

1. `executeAction()` runs the action inside revalidation ALS scope
2. If `revalidatePath(path)` was called, the revalidation renderer calls `buildRouteElement()` to produce the React element tree (not pre-serialized bytes)
3. `handleRscAction()` wraps both the action result and element tree in a single object and serializes via `renderToReadableStream`
4. The client's `callServer` callback decodes the response via `createFromFetch`, checks for the revalidation header, and calls `router.applyRevalidation()` to render the tree directly
5. If no revalidation was requested, the response is a bare action result and the client falls back to `router.refresh()`

This follows the same pattern as Next.js, where `renderToReadableStream({ a: actionResult, f: flightData })` serializes both values in one stream. React Flight handles progressive resolution of both values natively — no custom binary framing or stream splitting needed.

**Key design decisions:**

- The revalidation renderer returns a React element tree, not pre-serialized bytes. This allows the element tree to be serialized alongside the action result in a single `renderToReadableStream` call.
- `buildRouteElement()` (extracted from `renderRoute()`) handles module loading, access checks, metadata resolution, and element tree construction — reusable by both the render pipeline and the revalidation renderer.
- Actions that throw errors never include revalidation data — the error path short-circuits before `renderToReadableStream` sees the wrapper.

If `revalidatePath()` is NOT called, the response contains only the action result. The client calls `router.refresh()` as a fallback to pick up any other mutations.

### No-JS Action Flow

Forms must work via standard HTTP without JavaScript. Test with `curl`:

```bash
curl -X POST http://localhost:3000/todos \
  -d 'title=Buy+groceries' \
  -H 'Origin: http://localhost:3000' \
  -v
```

Expected: HTTP 302 redirect to the page showing the new state. The server action executes, then the framework issues a redirect response because no RSC client is available to receive the flight payload.

Test with Playwright in JS-disabled mode:

```typescript
test('form works without JS', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/todos');
  await page.fill('input[name=title]', 'Buy groceries');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL('/todos');
  await expect(page.locator('text=Buy groceries')).toBeVisible();
});
```

### Action Response Encoding

The action endpoint uses the same RSC wire format as navigation responses. The `Content-Type` is `text/x-component` (React's RSC MIME type). The client's action handler and navigation handler share the same RSC stream parser.

---

## Security

### CSRF Protection

Server actions validate the `Origin` header by default. The allowed origin is **auto-derived from the incoming request's `Host` header** — no configuration required for standard single-origin deployments. Requests whose `Origin` doesn't match the `Host` are rejected with 403. This is framework-level behavior, not opt-in.

For multi-origin deployments (CDN with a different domain, staging environments, OAuth callbacks), explicitly list allowed origins in `timber.config.ts`:

```ts
// timber.config.ts
export default {
  allowedOrigins: ['https://myapp.com', 'https://staging.myapp.com'],
  // csrf: false  — disable entirely (not recommended)
};
```

When `allowedOrigins` is set, the `Host`-based auto-derivation is replaced by the explicit list. The incoming `Origin` must match one of the listed values exactly (no wildcard matching). To disable CSRF protection entirely, set `csrf: false` — not recommended outside of local development.

Session cookies should use `SameSite=Lax` or `SameSite=Strict`. The framework does not set cookies on behalf of the developer, but auth documentation should recommend this.

### `redirect()` Is Relative-Only

`redirect('/path')` accepts relative paths only. Absolute URLs (`https://...`), protocol-relative URLs (`//evil.com`), and backslash-prefixed URLs (`/\evil.com`) are rejected at call time with an error.

For external redirects, use `redirectExternal(url, allowList)`:

```typescript
import { redirectExternal } from '@timber-js/app/server';

// Requires an explicit allow-list
redirectExternal(url, ['https://accounts.google.com', 'https://github.com']);
```

This prevents open redirect attacks where user-controlled input flows into `redirect()`.

### FormData Limits

The framework enforces configurable limits on incoming request bodies:

- **Max body size:** 1 MB for actions, 10 MB for file uploads (configurable)
- **Max field count:** 100 fields (configurable)

Requests exceeding these limits receive a 413 response. Configure in `timber.config.ts`:

```ts
export default {
  limits: {
    actionBodySize: '1mb',
    uploadBodySize: '10mb',
    maxFields: 100,
  },
};
```

---

## Implementation Architecture

### Client Side (`browser-entry.ts`)

The browser entry calls `setServerCallback` from `@vitejs/plugin-rsc/browser` to register the `callServer` function. When React invokes a server reference (from `'use server'` modules), it calls `callServer(id, args)` which:

1. Serializes args via `encodeReply` (RSC wire format)
2. POSTs to the current URL with `Accept: text/x-component` and `x-rsc-action: {actionId}` headers
3. Intercepts the response to check `X-Timber-Revalidation` and `X-Timber-Redirect` headers before decoding
4. Decodes the response via `createFromFetch`
5. If redirect: unpacks `{ _redirect, _status }`, calls `router.navigate()` for SPA transition
6. If piggybacked: unpacks `{ _action, _tree }`, calls `router.applyRevalidation()` with the tree, returns `_action`
7. If not piggybacked: triggers `router.refresh()` as fallback, returns the decoded result

The `x-rsc-action` header carries the action reference ID (format: `{fileId}#{exportName}`), which the server uses to look up the action function via `loadServerAction`.

### Server Side (`action-handler.ts`)

The action handler intercepts POST requests before the regular render pipeline. It handles two paths:

**With-JS path** (has `x-rsc-action` header):

1. `loadServerAction(id)` loads the action function by reference ID
2. `decodeReply(body)` deserializes the arguments from the RSC wire format
3. `executeAction(fn, args)` runs the action inside revalidation ALS scope
4. If `redirect()` was called: serializes `{ _redirect, _status }` via `renderToReadableStream`, sets `X-Timber-Redirect` header. The client performs a SPA `router.navigate()` instead of following an HTTP 302.
5. If `revalidatePath()` was called: serializes wrapper `{ _action, _tree }` via `renderToReadableStream`, sets `X-Timber-Revalidation: 1` header
6. Otherwise: serializes bare action result via `renderToReadableStream`

**No-JS path** (form POST with `$ACTION_REF` / `$ACTION_KEY` hidden fields):

1. `decodeAction(formData)` resolves the bound action function from React's hidden fields
2. Action executes
3. Server responds with 302 redirect back to the page (PRG pattern)

Both paths run inside `runWithRequestContext` so `headers()` and `cookies()` work during action execution. CSRF validation runs before any action logic.

### Why `serverHandler: false`

Timber uses `serverHandler: false` with `@vitejs/plugin-rsc` because timber has its own dev server (`timber-dev-server`) that handles request routing through the full pipeline (proxy → canonicalize → route match → middleware → render). The RSC plugin's default server handler would conflict with timber's pipeline. This means timber is responsible for wiring up both the client-side `callServer` callback and server-side action dispatch.

---

## FormData Preprocessing

### `parseFormData()`

Schema-agnostic FormData-to-object conversion that runs _before_ schema validation. Imported from `@timber-js/app/server`.

```typescript
import { parseFormData } from '@timber-js/app/server';

const obj = parseFormData(formData);
```

Handles:

- **Duplicate keys → arrays**: `tags=js&tags=ts` → `{ tags: ["js", "ts"] }`
- **Nested dot-paths**: `user.name=Alice` → `{ user: { name: "Alice" } }`
- **Empty strings → undefined**: Enables `.optional()` semantics in schemas
- **Empty Files → undefined**: File inputs with no selection become `undefined`
- **Strips `$ACTION_*` fields**: React's internal hidden fields are excluded

Replaces the framework's internal `formDataToObject()`. Automatically used by `createActionClient` and `validated()` when called with `(prevState, formData)`.

### `coerce` Helpers

Schema-agnostic coercion primitives for common FormData patterns:

```typescript
import { coerce } from '@timber-js/app/server';

coerce.number('42'); // → 42
coerce.number(''); // → undefined
coerce.checkbox('on'); // → true
coerce.checkbox(undefined); // → false
coerce.json('{"a":1}'); // → { a: 1 }
```

These compose with any schema library's transform pipeline:

```typescript
// Zod
z.preprocess(coerce.number, z.number());
// Valibot
v.pipe(v.unknown(), v.transform(coerce.number), v.number());
```

---

## `validated()` Convenience API

For the 90% case where you don't need middleware:

```typescript
'use server';
import { validated } from '@timber-js/app/server';
import { z } from 'zod';

export const createTodo = validated(z.object({ title: z.string().min(1) }), async (input) => {
  await db.todos.create(input);
});
```

Thin wrapper over `createActionClient().schema(schema).action()`.

---

## `useFormErrors()` Hook

Client-side error extraction hook for `ActionResult`:

```tsx
import { useFormErrors } from '@timber-js/app/client';

const [result, action, isPending] = useActionState(createTodo, null);
const errors = useFormErrors(result);

// errors.fieldErrors    — Record<string, string[]>
// errors.formErrors     — string[] (from _root key)
// errors.serverError    — { code, data? } | null
// errors.hasErrors      — boolean
// errors.getFieldError('title') — string | null (first error)
```

Pure function (no internal hooks). The `_root` key in `validationErrors` maps to `formErrors` for form-level flash-style messages.

---

## `submittedValues` in ActionResult

When schema validation fails, `ActionResult` includes the raw input for form repopulation:

```typescript
type ActionResult<TData> =
  | { data: TData }
  | { validationErrors: ValidationErrors; submittedValues?: Record<string, unknown> }
  | { serverError: { code: string; data?: Record<string, unknown> } };
```

File objects are stripped from `submittedValues` (can't serialize, shouldn't echo back). Use `defaultValue` props to repopulate form fields on validation failure.

---

## No-JS Error Round-Trip

### Problem

The no-JS path (form POST → 302 redirect) discards validation errors and submitted values. Forms silently lose user input on validation failure.

### Solution: `getFormFlash()`

When a no-JS form action returns validation errors, the server **re-renders the page** instead of redirecting. Validation errors and submitted values are injected via AsyncLocalStorage, readable by server components via `getFormFlash()`.

```typescript
// app/contact/page.tsx (server component)
import { getFormFlash } from '@timber-js/app/server'

export default function ContactPage() {
  const flash = getFormFlash()
  return <ContactForm flash={flash} />
}
```

**How it works:**

1. No-JS form submits via POST
2. Server action executes, returns `validationErrors` in the result
3. `handleFormAction` detects validation errors, returns a `{ rerender: FormFlashData }` signal instead of a 302 redirect
4. `rsc-entry.ts` wraps the pipeline re-render in `runWithFormFlash(data, () => pipeline(req))`
5. Server components call `getFormFlash()` to read errors/submitted values
6. Page renders with errors displayed and form fields repopulated

**Key decisions:**

- Flash data is server-side only (ALS) — never serialized to cookies or headers
- Validation failures are not mutations → PRG is unnecessary, re-render is correct
- Successful actions still 302 redirect (PRG preserved for the happy path)
- `FormFlashData` includes `validationErrors`, `submittedValues`, and optional `serverError`

```typescript
interface FormFlashData {
  validationErrors: ValidationErrors;
  submittedValues: Record<string, unknown>;
  serverError?: { code: string; data?: Record<string, unknown> };
}
```
