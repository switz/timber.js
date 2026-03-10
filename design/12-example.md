# Complete Examples

## Example 1: Server Mode — Dashboard (Default)

A dashboard page in `server` output mode. Every request renders fresh. This is the most common case.

```
app/
  (authenticated)/
    access.ts            ← auth gate for all dashboard routes
    layout.tsx           ← shared dashboard chrome
  (authenticated)/dashboard/
    projects/
      [projectId]/
        middleware.ts    ← headers, short-circuiting
        page.tsx         ← the page
        actions.ts       ← server actions
        404.tsx          ← 404 for missing projects
```

```typescript
// app/(authenticated)/access.ts
import { cookies, redirect } from '@timber/app/server'
import { requireUser } from '@/lib/auth'

export default async function access() {
  await requireUser()  // redirects to /login if no session
}
```

```typescript
// app/(authenticated)/dashboard/projects/[projectId]/middleware.ts
import { requireUser } from '@/lib/auth'
import { getProject, getTaskCounts } from '@/lib/data'

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  ctx.headers.set('Cache-Control', 'private, no-cache')

  // Fire all data fetches in parallel via timber.cache — do NOT await
  void requireUser()
  void getProject(ctx.params.projectId)
  void getTaskCounts(ctx.params.projectId)
  // middleware returns immediately → cache is warm when rendering starts
}
```

```tsx
// app/(authenticated)/dashboard/projects/[projectId]/page.tsx
import { Suspense } from 'react'
import { getProject, getTaskCounts } from '@/lib/data'

export default async function ProjectPage({ params }) {
  const project = await getProject(params.projectId)  // timber.cache HIT (handler warmed it)
  if (!project) deny(404)                                // real HTTP 404

  return (
    <div>
      <ProjectHeader project={project} />
      <ProjectDetails project={project} />

      <Suspense fallback={<ActivitySkeleton />}>
        {/* streams after flush: secondary content */}
        <RecentActivity projectId={project.id} />
      </Suspense>
    </div>
  )
}
```

```typescript
// app/(authenticated)/dashboard/projects/[projectId]/actions.ts
'use server'
import { action } from '@/lib/action'
import { z } from 'zod/v4'

export const updateProject = action
  .schema(z.object({ projectId: z.string(), name: z.string().min(1), description: z.string() }))
  .action(async ({ input, ctx }) => {
    await db.projects.update(input.projectId, { name: input.name, description: input.description })
    return revalidatePath(`/dashboard/projects/${input.projectId}`)
  })
```

### What Happens on Each Request

1. `proxy.ts` runs (security headers, logging)
2. `middleware.ts` fires `timber.cache` prefetches — all data loads start at t=0
3. React renders the tree top-down:
   - `AccessGate` calls `requireUser()` → `timber.cache` HIT (handler warmed it) → passes
   - `AuthLayout` renders dashboard chrome
   - `ProjectPage` calls `getProject()` → `timber.cache` HIT → renders or calls `deny(404)`
4. `onShellReady` fires → HTTP 200 (or 404) committed → shell flushed
5. `<RecentActivity>` inside `<Suspense>` streams in when ready

No complexity. Every request is fresh with correct HTTP status codes.

---

## Example 2: Public Product Page with Streaming

A public product page with cache warming, server actions, and streaming secondary content.

```
app/
  products/
    [id]/
      middleware.ts    ← headers
      page.tsx         ← the page
      actions.ts       ← server actions
      404.tsx          ← 404 for missing products
      error.tsx        ← error boundary
```

```typescript
// app/products/[id]/middleware.ts
export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  ctx.headers.set('Cache-Control', 'public, max-age=60')
  // Warm caches — do NOT await
  void getProduct(ctx.params.id)
  void getProductReviews(ctx.params.id)
}
```

```tsx
// app/products/[id]/page.tsx
import { Suspense } from 'react'
import { getProduct } from '@/lib/data'

export default async function ProductPage({ params }) {
  const product = await getProduct(params.id)  // timber.cache HIT (handler warmed it)
  if (!product) deny(404)                        // real HTTP 404

  return (
    <div>
      <ProductHeader product={product} />
      <ProductDescription product={product} />

      <Suspense fallback={<ReviewsSkeleton />}>
        {/* streams after flush: secondary content */}
        <ProductReviews productId={product.id} />
      </Suspense>
    </div>
  )
}
```

```typescript
// app/products/[id]/actions.ts
'use server'

export async function addToCart(productId: string) {
  const user = await getUser()
  if (!user) return redirect('/login')

  await db.cart.add(user.id, productId)
  timber.cache.invalidate({ tag: `cart:${user.id}` })
  return revalidatePath(`/products/${productId}`)
}
```

### What Happens on Each Request

1. `proxy.ts` runs (security headers, logging)
2. `middleware.ts` fires `timber.cache` prefetches + sets `Cache-Control`
3. React renders the tree top-down:
   - `ProductPage` calls `getProduct()` → `timber.cache` HIT → renders or calls `deny(404)`
4. `onShellReady` fires → HTTP 200 (or 404) committed → shell flushed
5. `<ProductReviews>` inside `<Suspense>` streams in when ready

Public page, correct HTTP status codes, CDN-cacheable via `Cache-Control`.
