// MIGRATION: Several Next.js-specific caching APIs used here:
//
// 1. 'use cache: private' → timber.cache() with cookies in the function.
//    timber.cache() supports user-scoped caching by including request-specific
//    data (cookies) in the cache key via the key: option.
//
// 2. cacheTag() → timber.cache() tags option
//
// 3. cacheLife() → timber.cache() ttl/staleWhileRevalidate options
//
// 4. unstable_prefetch → Not supported in timber. Gap filed as bd issue.
//
// Before (Next.js):
//   async function getRecommendations(productId: string) {
//     'use cache: private';
//     cacheTag(`recommendations-${productId}`);
//     cacheLife({ stale: 60 });
//     const sessionId = (await cookies()).get('session-id')?.value || 'guest';
//     return getPersonalizedRecommendations(productId, sessionId);
//   }
//
// After (timber):
//   const getRecommendations = createCache(
//     async (productId: string, sessionId: string) => { ... },
//     { tags: (productId) => [`recommendations-${productId}`], ttl: 60 }
//   )

import { Suspense } from 'react';
import db from '#/lib/db';
import { Boundary } from '#/ui/boundary';
import { ProductCard } from '#/ui/product-card';
import { createCache } from '@timber/app/cache';
import { cookies } from 'next/headers';
import { getPersonalizedRecommendations } from '../../../_components/recommendations';
import { notFound } from 'next/navigation';
import { ProductDetails } from '#/app/private-cache/_components/product-detail';
import Link from 'next/link';
import { ChevronLeftIcon } from '@heroicons/react/24/solid';

// MIGRATION: unstable_prefetch is a Next.js runtime prefetch hint — not
// supported in timber. Timber uses <Link prefetch> for hover-based prefetch.
// export const unstable_prefetch = { ... }  ← removed

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await db.product.find({ where: { id } });

  if (!product) {
    notFound();
  }

  return (
    <Boundary label="page.tsx (with-private)" animateRerendering={false}>
      <div className="flex flex-col gap-8">
        <Link
          href="/private-cache"
          className="flex items-center gap-2 font-medium text-gray-300 hover:text-white"
        >
          <ChevronLeftIcon className="size-6 text-gray-600" />
          <div>Shop</div>
        </Link>

        {/* Static Product Details */}
        <ProductDetails product={product} />

        {/* Private Cache (user-scoped via session cookie) */}
        <Suspense fallback={<RecommendationsSkeleton />}>
          <Recommendations productId={id} />
        </Suspense>
      </div>
    </Boundary>
  );
}

async function Recommendations({ productId }: { productId: string }) {
  // MIGRATION: Read cookies before calling cached function, pass as arg.
  // This is required in timber — cookies() can't be called inside cached
  // functions (they're shared across requests). The session ID becomes part
  // of the function args and thus part of the cache key.
  const sessionId = (await cookies()).get('session-id')?.value ?? 'guest';
  const recommendations = await getRecommendations(productId, sessionId);

  return (
    <Boundary label="<Recommendations> (User-Scoped Cache)" size="small" animateRerendering={false}>
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-gray-300">Recommendations</h2>
        {recommendations.length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-8 text-center">
            <p className="text-gray-500">No recommendations available</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {recommendations.map((rec) => (
              <ProductCard key={rec.id} product={rec} />
            ))}
          </div>
        )}
      </div>
    </Boundary>
  );
}

// MIGRATION: 'use cache: private' + cacheTag() + cacheLife() → timber.cache()
// User-scoped caching: sessionId is passed as an arg, so each user gets
// their own cache entry (the cache key includes sessionId).
const getRecommendations = createCache(
  async (productId: string, sessionId: string) => {
    return getPersonalizedRecommendations(productId, sessionId);
  },
  { ttl: 60, tags: (productId: string) => [`recommendations-${productId}`] }
);

function RecommendationsSkeleton() {
  return (
    <Boundary
      label="<Recommendations> (User-Scoped Cache)"
      size="small"
      color="blue"
      animateRerendering={false}
    >
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-gray-300">Recommendations</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg bg-gray-800" />
          ))}
        </div>
      </div>
    </Boundary>
  );
}
