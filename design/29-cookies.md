# Cookies

## Current State

timber.js has `cookies()` — an ALS-backed read-only accessor that parses the incoming `Cookie` header. It returns `{ get, has, getAll }`. There is no mechanism for **setting** cookies. No `Set-Cookie` headers are ever produced by the framework.

This document designs the full cookies interface: reading, writing, merging across pipeline layers, and the constraints imposed by streaming.

---

## Design Principles

1. **Cookies are HTTP headers.** They are not magic state. `Set-Cookie` is a response header. The `Cookie` header is a request header. The API should reflect this.

2. **Headers commit at the flush point.** Once `onShellReady` fires and the shell begins streaming, response headers (including `Set-Cookie`) are committed. Any attempt to set a cookie after the flush is a bug — the framework must catch it and warn.

3. **Explicit over implicit.** No automatic session management, no framework-managed cookie jar. The developer controls what cookies are set and where.

4. **Secure defaults.** New cookies default to `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`. The developer overrides explicitly.

---

## API Surface

### Reading: `cookies()` (existing)

No changes to the read API. `cookies()` returns a read-only view of incoming request cookies:

```typescript
import { cookies } from '@timber/app/server';

const session = cookies().get('session_id');
const all = cookies().getAll();
```

Available in: `proxy.ts`, `middleware.ts`, `access.ts`, server components, server actions, `route.ts` handlers.

### Writing: `cookies().set()` / `cookies().delete()`

The `cookies()` return type gains mutation methods — but only in contexts where mutation is safe. This follows the same object, context-dependent behavior pattern as `deny()` (which behaves differently in segments vs slots).

```typescript
import { cookies } from '@timber/app/server';

// In middleware.ts, server actions, or route.ts handlers:
cookies().set('theme', 'dark');
cookies().set('session_id', token, {
  httpOnly: true, // default: true
  secure: true, // default: true
  sameSite: 'lax', // default: 'lax'
  path: '/', // default: '/'
  maxAge: 60 * 60 * 24 * 30, // 30 days
});
cookies().delete('old_cookie');

// In server components (RSC):
cookies().set('anything', 'value');
// → THROWS: "cookies().set() cannot be called in a server component.
//    Set cookies in middleware.ts, server actions, or route.ts handlers."
```

### Cookie Options

```typescript
interface CookieOptions {
  /** Domain scope. Default: omitted (current domain only). */
  domain?: string;
  /** URL path scope. Default: '/'. */
  path?: string;
  /** Expiration date. Mutually exclusive with maxAge. */
  expires?: Date;
  /** Max age in seconds. Mutually exclusive with expires. */
  maxAge?: number;
  /** Prevent client-side JS access. Default: true. */
  httpOnly?: boolean;
  /** Only send over HTTPS. Default: true. */
  secure?: boolean;
  /** Cross-site request policy. Default: 'lax'. */
  sameSite?: 'strict' | 'lax' | 'none';
  /**
   * Partitioned (CHIPS) — isolate cookie per top-level site.
   * Requires secure=true and sameSite='none'. Default: false.
   */
  partitioned?: boolean;
}
```

**Why `httpOnly: true` and `secure: true` by default:** Most cookies set by server code contain sensitive data (sessions, tokens, preferences that affect server rendering). Defaulting to secure settings prevents accidental exposure. Developers who need client-readable cookies (theme preference for client-side JS) explicitly set `httpOnly: false`.

### Deleting Cookies

`cookies().delete(name)` sets a `Set-Cookie` header with `Max-Age=0` and `Expires` in the past. This is the standard HTTP mechanism — there is no "delete cookie" header.

```typescript
cookies().delete('session_id');
// Equivalent to: Set-Cookie: session_id=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT
```

Options can be passed to match the original cookie's scope:

```typescript
cookies().delete('session_id', { path: '/dashboard', domain: '.example.com' });
```

---

## Where Cookies Can Be Set

| Context                 | Read | Write | Why                                                               |
| ----------------------- | ---- | ----- | ----------------------------------------------------------------- |
| `proxy.ts`              | Yes  | Yes   | Wraps entire lifecycle, has access to the response                |
| `middleware.ts`         | Yes  | Yes   | Runs before flush, can set response headers                       |
| `access.ts`             | Yes  | No    | Auth gate — should not have side effects                          |
| Server components (RSC) | Yes  | No    | May run after flush (inside Suspense); no response header access  |
| Server actions          | Yes  | Yes   | Mutation context — setting cookies after auth changes is expected |
| `route.ts` handlers     | Yes  | Yes   | Full request/response control                                     |
| Client components       | No   | No    | Use `document.cookie` directly for client-only cookies            |

### Why Not in Server Components?

Server components can run inside `<Suspense>` boundaries, which resolve **after** the flush point. At that point, response headers are already committed — `Set-Cookie` cannot be added. Rather than allowing it only outside Suspense (which would be confusing and error-prone), we prohibit it entirely in RSC. This is the same constraint as Next.js.

### Why Not in `access.ts`?

`access.ts` is a pure authorization gate — it should check permissions, not produce side effects. If an access check needs to set a cookie (e.g., refreshing a session token), that logic belongs in `middleware.ts` (which runs before access) or in a server action (which runs on explicit user interaction).

---

## Cookie Flow Through the Pipeline

```
Request arrives with Cookie: session_id=abc; theme=dark
  │
  ├── proxy.ts
  │     cookies().get('session_id') → 'abc'     (reads incoming)
  │     cookies().set('_trace', traceId)         (sets outgoing)
  │     → Set-Cookie jar: [_trace=...]
  │
  ├── middleware.ts
  │     cookies().get('session_id') → 'abc'     (reads incoming)
  │     cookies().get('_trace') → traceId       (reads own + proxy's sets)
  │     cookies().set('session_id', newToken)    (refreshes session)
  │     → Set-Cookie jar: [_trace=..., session_id=...]
  │
  ├── access.ts
  │     cookies().get('session_id') → newToken   (sees refreshed value)
  │     cookies().set(...) → THROWS
  │
  ├── Server component render
  │     cookies().get('session_id') → newToken   (sees refreshed value)
  │     cookies().set(...) → THROWS
  │
  ├── onShellReady — FLUSH POINT
  │     Response headers committed:
  │       Set-Cookie: _trace=...; HttpOnly; Secure; SameSite=Lax; Path=/
  │       Set-Cookie: session_id=...; HttpOnly; Secure; SameSite=Lax; Path=/
  │
  └── Suspense boundaries stream (no more Set-Cookie possible)
```

### Read-Your-Own-Writes

When `cookies().set('session_id', newToken)` is called in middleware, subsequent `cookies().get('session_id')` calls in the same request should return `newToken`, not the original value from the incoming `Cookie` header. This is read-your-own-writes semantics.

The implementation maintains a write-overlay on the ALS store. `cookies().get()` checks the overlay first, then falls back to the parsed incoming header.

---

## `Set-Cookie` Header Merging

Multiple pipeline layers can set cookies. Unlike most headers, `Set-Cookie` headers must NOT be merged into a single comma-separated value — each cookie gets its own `Set-Cookie` header. This is per RFC 6265 §4.1:

```http
Set-Cookie: session_id=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
Set-Cookie: _trace=xyz789; HttpOnly; Secure; SameSite=Lax; Path=/
Set-Cookie: theme=dark; SameSite=Lax; Path=/
```

The framework uses `Headers.append('Set-Cookie', ...)` (not `.set()`) for each cookie. At flush time, all accumulated `Set-Cookie` headers are applied to the response.

### Last-Write-Wins for Same Name

If multiple layers set the same cookie name, the last write wins. `proxy.ts` sets `theme=light`, middleware sets `theme=dark` → the response has one `Set-Cookie: theme=dark` header, not two. The cookie jar deduplicates by name before serializing to headers.

---

## Server Actions and Cookies

Server actions can set cookies. This is the primary mechanism for auth flows:

```typescript
'use server';
import { cookies, redirect } from '@timber/app/server';

export async function login(formData: FormData) {
  const user = await authenticate(formData.get('email'), formData.get('password'));
  if (!user) throw new ActionError('INVALID_CREDENTIALS');

  const token = await createSession(user.id);
  cookies().set('session_id', token, { maxAge: 60 * 60 * 24 * 30 });
  redirect('/dashboard');
}

export async function logout() {
  cookies().delete('session_id');
  redirect('/login');
}
```

### How Action Cookies Reach the Client

Server actions return an RSC stream response. `Set-Cookie` headers are added to that response. The browser processes them normally — no special client-side handling needed.

For **no-JS form submissions**, the action handler returns a 302 redirect. `Set-Cookie` headers are included on the redirect response. The browser stores the cookie before following the redirect. Standard HTTP.

---

## `proxy.ts` Cookie Access

`proxy.ts` wraps the entire request lifecycle via `(req, next) => Response`. It can set cookies on the outgoing response by manipulating the Response returned by `next()`:

```typescript
// Option A: Use cookies() — framework merges into final response
export default async function proxy(req: Request, next: () => Promise<Response>) {
  cookies().set('_trace', crypto.randomUUID(), { httpOnly: true });
  const response = await next();
  return response; // Set-Cookie headers include _trace
}

// Option B: Set headers directly on the response (escape hatch)
export default async function proxy(req: Request, next: () => Promise<Response>) {
  const response = await next();
  response.headers.append('Set-Cookie', 'manual=value; Path=/');
  return response;
}
```

Option A is preferred — it participates in read-your-own-writes and deduplication. Option B is an escape hatch for advanced cases (e.g., proxying `Set-Cookie` from an upstream service).

When `proxy.ts` uses option B to set `Set-Cookie` headers directly on the response, these are additive to — not replaced by — the framework's cookie jar. At flush time, the framework appends its jar entries to whatever `Set-Cookie` headers already exist on the response.

---

## Streaming Constraint: Post-Flush Cookie Warning

If code attempts to set a cookie after the flush point (which should only happen if there's a bug — the API prevents it in server components), the framework emits a dev-mode warning:

```
[timber] warn: cookies().set('name') called after response headers were committed.
  The cookie will NOT be sent. Move cookie mutations to middleware.ts, a server action,
  or a route.ts handler.
```

In production, the call is silently ignored (no crash). This matches the behavior of other post-flush operations — the ship has sailed.

---

## Implementation: ALS Cookie Jar

The cookie jar is stored in the existing `RequestContextStore`:

```typescript
interface RequestContextStore {
  headers: Headers;
  cookieHeader: string;
  parsedCookies?: ReadonlyMap<string, string>;
  originalHeaders: Headers;
  searchParamsPromise: Promise<...>;

  // New fields for cookie writing:
  /** Outgoing Set-Cookie entries (name → serialized value + options). */
  cookieJar: Map<string, CookieEntry>;
  /** Whether the response has flushed (headers committed). */
  flushed: boolean;
  /** Whether the current context allows cookie mutation. */
  mutableContext: boolean;
}

interface CookieEntry {
  name: string;
  value: string;
  options: CookieOptions;
  /** Serialized Set-Cookie header value, computed lazily. */
  serialized?: string;
}
```

### Context Tracking

The `mutableContext` flag is set by the framework when entering a context that allows cookie writes:

- `proxy.ts`: `mutableContext = true`
- `middleware.ts`: `mutableContext = true`
- `access.ts`: `mutableContext = false`
- Server components: `mutableContext = false`
- Server actions: `mutableContext = true`
- `route.ts` handlers: `mutableContext = true`

When `cookies().set()` is called with `mutableContext = false`, it throws immediately with a descriptive error.

### Flush Tracking

The `flushed` flag is set to `true` when `onShellReady` fires and headers are committed. After this point, `cookies().set()` in a mutable context logs a warning (dev) or is silently ignored (prod) instead of throwing.

---

## Signed Cookies

Signed cookies prevent tampering — the server can verify that a cookie value was set by the server and has not been modified. This is useful for storing non-secret data (preferences, feature flags) that must be trusted.

### API

```typescript
import { cookies } from '@timber/app/server';

// Sign on write
cookies().set('prefs', JSON.stringify({ lang: 'en' }), { signed: true });

// Verify on read — returns undefined if signature is invalid
const prefs = cookies().getSigned('prefs');
```

### Implementation

Signing uses HMAC-SHA256 with a secret from `timber.config.ts`:

```typescript
// timber.config.ts
export default {
  cookies: {
    secret: process.env.COOKIE_SECRET,
    // Or rotate secrets:
    secrets: [process.env.COOKIE_SECRET_NEW, process.env.COOKIE_SECRET_OLD],
  },
};
```

The cookie value is stored as `value.signature`:

```
Set-Cookie: prefs=eyJsYW5nIjoiZW4ifQ.HMAC_SHA256_HEX; HttpOnly; Secure; ...
```

When `cookies().getSigned('prefs')` is called:

1. Split value at the last `.`
2. Verify HMAC against each secret in the `secrets` array (newest first)
3. Return the value if any signature matches, `undefined` if none match

**Secret rotation:** The `secrets` array supports key rotation. The newest secret (index 0) is used for signing. All secrets are tried for verification. This allows deploying a new secret before removing the old one.

### Not Encryption

Signed cookies are **not encrypted**. The value is readable by anyone with the cookie. For sensitive data, use encrypted cookies or store the data server-side with a session ID cookie.

Encrypted cookies are a future consideration. The signing primitive is sufficient for v1 — most apps that need encrypted cookies should use a session store instead.

---

## Cloudflare Workers Considerations

Cloudflare Workers use the standard `Request`/`Response` Web API. `Set-Cookie` on the Response works as expected. No platform-specific handling needed.

One consideration: Workers have a 4KB limit per cookie (standard browser limit) and a combined response header size limit. The framework does not enforce this — the platform does. If a cookie exceeds the limit, the Worker runtime rejects the response. A dev-mode warning could be added if a serialized cookie exceeds 4KB, but this is not critical for v1.

---

## What This Design Does NOT Include

1. **Session management.** No built-in session abstraction. The developer manages sessions with cookies as the transport.

2. **Encrypted cookies.** Not in v1. Signing covers integrity; encryption covers confidentiality. Most confidential data belongs server-side.

3. **Cookie-based flash messages.** Form flash uses ALS (`form-flash.ts`), not cookies. This is intentional — flash data is server-side only and never exposed to the client.

4. **Automatic CSRF cookies.** CSRF protection uses `Origin` header validation, not double-submit cookies. No CSRF cookie needed.

5. **Automatic CSRF cookies.** CSRF protection uses `Origin` header validation, not double-submit cookies. No CSRF cookie needed.

---

## Client-Side Cookies

### The Problem

Several common patterns require client-side cookie access:

- **Theme toggle** — user clicks "dark mode", client JS sets a cookie, server reads it on the next request to render the correct theme without a flash
- **Consent banner** — client JS sets a consent cookie, server reads it to decide whether to include analytics scripts
- **Client-side A/B assignment** — client assigns a variant, persists it in a cookie, server reads it for consistent rendering
- **Dismissible UI** — "don't show this again" banners that persist across page loads

All of these share a pattern: the **client writes** a cookie, and the **server reads** it on the next navigation. The cookie bridges the two worlds.

### `useCookie(name)` Hook

```typescript
import { useCookie } from '@timber/app/client';

function ThemeToggle() {
  const [theme, setTheme] = useCookie('theme');
  // theme: string | undefined — current cookie value
  // setTheme: (value: string, options?) => void — sets the cookie

  return (
    <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      Toggle theme
    </button>
  );
}
```

**Signature:**

```typescript
function useCookie(
  name: string,
  options?: ClientCookieOptions
): [value: string | undefined, setCookie: CookieSetter, deleteCookie: () => void];

type CookieSetter = (value: string, options?: ClientCookieOptions) => void;

interface ClientCookieOptions {
  /** URL path scope. Default: '/'. */
  path?: string;
  /** Domain scope. Default: omitted (current domain). */
  domain?: string;
  /** Max age in seconds. */
  maxAge?: number;
  /** Expiration date. */
  expires?: Date;
  /** Cross-site policy. Default: 'lax'. */
  sameSite?: 'strict' | 'lax' | 'none';
  /** Only send over HTTPS. Default: true in production. */
  secure?: boolean;
}
```

**Note:** No `httpOnly` option — client-side cookies cannot be `HttpOnly` by definition (the browser must access them via `document.cookie`). This is a natural constraint, not a design choice.

### Reactivity

`useCookie` is reactive — when the cookie changes (via `setTheme` or another `useCookie` instance on the same page), all components using `useCookie('theme')` re-render with the new value.

Implementation uses `useSyncExternalStore` with a module-level cookie store that listens for changes. When `setCookie` is called, it:

1. Writes to `document.cookie`
2. Notifies all subscribers for that cookie name
3. React re-renders components that read the cookie

Cross-tab sync is **not** included — `document.cookie` does not fire events when another tab changes a cookie. If needed, developers can use the `storage` event with a `localStorage` sidecar (userland pattern). This is rare enough to not warrant framework support.

### SSR Hydration

During SSR, cookies come from the incoming `Cookie` request header. During hydration, they come from `document.cookie`. These should match — the server just set the response, and the browser sends back what it has.

`useCookie` uses `useSyncExternalStore`'s server snapshot parameter:

- **Server snapshot:** Read from the ALS-backed `cookies().get(name)` — the same value the server component tree sees
- **Client snapshot:** Read from `document.cookie`

If they diverge (rare — e.g., a browser extension modified a cookie), React handles the mismatch via the standard hydration mismatch path.

### When to Use Server vs Client Cookie APIs

| Scenario | API | Why |
|---|---|---|
| Session token | `cookies().set()` in middleware/action | HttpOnly, never exposed to client JS |
| Auth redirect | `cookies()` in `access.ts` | Server-side auth check |
| Theme preference (server render) | `cookies().get()` in layout | Server reads for initial render |
| Theme preference (toggle) | `useCookie()` in client component | Client writes on user interaction |
| Consent banner | `useCookie()` in client component | Client writes, server reads on next request |
| Analytics ID | `cookies().set()` in middleware | Server-generated, HttpOnly |

The general rule: **if the value is set by user interaction in the browser, use `useCookie()`. If it's set by server logic, use `cookies().set()`.** Many cookies are read by both — the server reads them via `cookies().get()`, and the client reads them via `useCookie()`.

### Server Action + Cookie Roundtrip

A common pattern is a server action that sets a cookie, followed by the client reading it. This works naturally:

```typescript
// actions.ts — server
'use server';
import { cookies } from '@timber/app/server';

export async function setLocale(locale: string) {
  cookies().set('locale', locale, { httpOnly: false }); // httpOnly: false so client can read
  return revalidatePath('/');
}
```

```tsx
// locale-picker.tsx — client
'use client';
import { useCookie } from '@timber/app/client';
import { setLocale } from './actions';

export function LocalePicker() {
  const [locale] = useCookie('locale');

  return (
    <form action={setLocale}>
      <select name="locale" defaultValue={locale}>
        <option value="en">English</option>
        <option value="fr">Français</option>
      </select>
      <button type="submit">Save</button>
    </form>
  );
}
```

After the action completes and the page revalidates, `useCookie('locale')` returns the new value because the browser received the `Set-Cookie` header from the action response.

### No `useCookies()` (Plural)

Unlike `useQueryStates` (which manages multiple URL params as a group), there is no `useCookies()` that watches all cookies. Cookies are independent key-value pairs with independent lifecycles. Watching all cookies would cause unnecessary re-renders — a change to an analytics cookie would re-render a theme toggle. Use one `useCookie(name)` per cookie.

---

## Prior Art Comparison

| Feature              | Next.js                                         | Remix                                             | Astro                 | timber.js                                                   |
| -------------------- | ----------------------------------------------- | ------------------------------------------------- | --------------------- | ----------------------------------------------------------- |
| Read API             | `cookies()` async fn                            | `request.headers.get('cookie')` + `cookie` helper | `Astro.cookies.get()` | `cookies().get()`                                           |
| Write API            | `cookies().set()` (actions/route handlers only) | Return `Set-Cookie` headers manually              | `Astro.cookies.set()` | `cookies().set()` (middleware/actions/route handlers)       |
| RSC writes           | No (throws)                                     | N/A                                               | N/A                   | No (throws)                                                 |
| Middleware writes    | No (read-only in middleware)                    | N/A                                               | N/A                   | **Yes** — middleware is a natural place for session refresh |
| Client-side hook     | No (use `document.cookie`)                      | No                                                | No                    | `useCookie(name)` — reactive, SSR-hydrated                 |
| Signed cookies       | No                                              | Yes (`createCookie` with signing)                 | No                    | Yes (HMAC-SHA256)                                           |
| Defaults             | No defaults                                     | No defaults                                       | No defaults           | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`              |
| Read-your-own-writes | No                                              | N/A                                               | Yes                   | Yes                                                         |

### Key Difference from Next.js

Next.js does not allow setting cookies in middleware — middleware can only read cookies and set response headers manually. timber.js allows `cookies().set()` in middleware because middleware runs before the flush point and is the natural place for session token refresh. This eliminates a common pain point where Next.js developers must work around the middleware cookie limitation.

---

## Open Questions

1. **Should `cookies()` in `proxy.ts` see cookies set by other proxy middleware in the array form?** If `proxy.ts` exports `[setCookieMiddleware, readCookieMiddleware]`, the second middleware should see cookies set by the first. This requires the cookie jar to be shared across the proxy chain. The current design supports this (ALS-backed), but it needs explicit testing.

2. **Should there be a `cookies().getWithMetadata(name)` that returns the options (path, domain, etc.) of an incoming cookie?** Incoming cookies only send `name=value` — the browser does not send back options. This would only be useful for cookies set during the current request (from the jar). Deferring unless there's a concrete use case.

3. **Cookie size warnings.** Should the framework warn when a serialized `Set-Cookie` header exceeds 4KB? This is a browser limit that varies slightly. A dev-mode warning seems useful but is not critical.
