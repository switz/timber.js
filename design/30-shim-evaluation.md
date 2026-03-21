# Shim Evaluation: Should timber remove next/\* shims?

**Status:** Evaluation complete — recommendation: **keep shims, but simplify**

**Task:** LOCAL-303

---

## Summary

After auditing the shim system, ecosystem dependencies, and bug surface area, the recommendation is:

1. **Keep** `next/link`, `next/navigation`, `next/headers`, `next/image` shims
2. **Keep** `server-only` / `client-only` poison pills
3. **Keep** `next/font/google` and `next/font/local` (handled by timber-fonts plugin)
4. **Simplify** the environment-aware resolution (`CLIENT_SHIM_OVERRIDES`) — this is the bug source
5. **Fix** the module duplication root cause (LOCAL-302) instead of removing shims

Removing shims would break ecosystem compatibility (a core value per `design/14-ecosystem.md`) without proportional benefit. The bugs are in the resolution machinery, not in the shims themselves.

---

## Audit: What the shims actually cost

### Code size

| Component              | Lines   | Complexity                                      |
| ---------------------- | ------- | ----------------------------------------------- |
| `shims.ts` (plugin)    | 155     | Medium — environment detection, virtual modules |
| `navigation.ts`        | 21      | Low — pure re-exports                           |
| `navigation-client.ts` | 52      | Low — re-exports + stubs                        |
| `link.ts`              | 11      | Trivial — re-export                             |
| `headers.ts`           | 9       | Trivial — re-export                             |
| `image.ts`             | 48      | Low — pass-through component                    |
| `font-google.ts`       | 67      | Low — stub functions                            |
| **Total**              | **363** |                                                 |

The shim code itself is simple. Most files are pure re-exports — thin wrappers that map `next/*` to existing `@timber-js/app/*` APIs.

### Bug surface area

The bugs attributed to shims are actually in the **resolution machinery**, not the shims:

1. **Module duplication (LOCAL-302):** `router-ref.ts` gets two instances because `#/` subpath imports resolve to different Vite module URLs than relative imports. This is a Vite module resolution bug — it would exist even without next/\* shims if any two import paths resolve the same file via different URLs.

2. **`CLIENT_SHIM_OVERRIDES`:** The environment-aware split (`navigation.ts` vs `navigation-client.ts`) exists to prevent server code from leaking into the browser bundle. This is legitimate but adds complexity. The fix is to make `navigation.ts` itself environment-safe (conditional re-exports or two separate modules behind the same shim entry), not to remove shims.

3. **`stripJsExtension` hack:** Required because nuqs imports `next/navigation.js` with explicit extension. This is a one-liner and not a maintenance burden.

### Maintenance burden

The shim surface is **stable**. Next.js's public API for these modules hasn't changed significantly in 2+ years:

- `next/link` — unchanged since App Router launch
- `next/navigation` — `useRouter`, `usePathname`, `useSearchParams`, `redirect`, `notFound` are all stable
- `next/headers` — `headers()`, `cookies()` are stable
- `next/image` — stable (we stub it anyway)

New additions (e.g., `useLinkStatus`, `forbidden()`) can be shimmed incrementally or ignored.

---

## Audit: Ecosystem library dependencies

### Libraries that import next/\*

| Library                        | Imports                                                           | Compatible today?          |
| ------------------------------ | ----------------------------------------------------------------- | -------------------------- |
| **nuqs**                       | `next/navigation.js` (`useRouter`, `useSearchParams`)             | ✅ Yes                     |
| **next-intl**                  | `next/navigation` (hooks + redirect), `next/link`, `next/headers` | ✅ Yes (except middleware) |
| **next-themes**                | None                                                              | ✅ Yes (no shims needed)   |
| **bright** (code highlighting) | `server-only`                                                     | ✅ Yes                     |

### Could these libraries use @timber-js/app/\* instead?

**No.** These are published npm packages that import `next/*`. They can't import `@timber-js/app/*` because:

1. They don't know about timber — they target the Next.js ecosystem
2. Forking them defeats the purpose (ecosystem compatibility is a core value)
3. "Thin adapter layers" would just re-create the shim system in userland

The only alternative to framework-level shims is asking users to fork ecosystem libraries or maintain manual patches. This is strictly worse.

---

## Audit: Would removing shims fix LOCAL-302?

**No.** LOCAL-302's root cause is Vite resolving `#/client/use-router.js` → `router-ref.ts` via a different module URL than `./router-ref.js` from `browser-entry.ts`. This happens because:

- The shim chain goes: `next/navigation` → `shims/navigation-client.ts` → `#/client/use-router.js`
- The browser entry goes: `virtual:timber-browser-entry` → `./router-ref.js`

Even without shims, if any user code imports `useRouter` from `@timber-js/app/client` while the browser entry imports `router-ref` relatively, the same duplication could occur. The fix is canonicalizing `#/` imports in Vite's resolver — a one-hook fix in the plugin, not a shim removal.

---

## Recommendation

### Keep shims, fix the resolution layer

1. **Fix LOCAL-302** by adding a `resolveId` hook that canonicalizes `#/` subpath imports to absolute file paths. This eliminates the module duplication regardless of whether imports come through shims or direct imports.

2. **Simplify `CLIENT_SHIM_OVERRIDES`** by making `navigation.ts` itself environment-safe. Options:
   - Use `import.meta.env.SSR` to conditionally export server functions
   - Split the re-exports so the module graph naturally tree-shakes server code
   - Or keep the current approach (it's only 1 override entry)

3. **Keep `server-only` / `client-only`** — these are React ecosystem conventions, not Next.js-specific. Every RSC framework needs them.

4. **Keep the shim map as-is** — it's small (6 entries), stable, and enables real ecosystem library compatibility.

### What would removal look like?

If we ever decide to remove shims:

- `next-playground-migration` example would need full rewrite to `@timber-js/app/*` imports
- nuqs, next-intl users would need to either fork those libraries or install a userland shim package
- A codemod could handle user code (`next/link` → `@timber-js/app/client`), but can't fix third-party deps
- `server-only` / `client-only` must remain regardless
- Net savings: ~200 lines of shim code, ~50 lines of plugin resolution code

**This is not worth the ecosystem breakage.** The shim system is a feature, not technical debt.

---

## Decision

**Keep all shims.** Focus engineering effort on LOCAL-302 (module duplication fix) and simplifying the resolution machinery. The shims themselves are thin, stable, and provide real value.
