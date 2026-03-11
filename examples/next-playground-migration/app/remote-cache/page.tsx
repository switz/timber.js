// MIGRATION: 'use cache: remote' is a Next.js-specific cache variant that
// caches data in a remote cache at runtime even in dynamic contexts.
// In timber, timber.cache() always uses the configured CacheHandler
// (which can be an external store), so there's no distinction between
// 'use cache' and 'use cache: remote'.
//
// Before (Next.js):
//   async function getProductPrice(productId: string) {
//     'use cache: remote';
//     cacheTag(`product-price-${productId}`, `product-${productId}`);
//     ...
//   }
//
// After (timber):
//   const getProductPrice = cache(async (productId: string) => { ... }, {
//     tags: (productId) => [`product-price-${productId}`, `product-${productId}`]
//   })

import { Suspense } from 'react';
import db from '#/lib/db';
import { Boundary } from '#/ui/boundary';
import { cache } from '@timber/app/cache';

const DEMO_PRODUCT_ID = '1';

export default async function Page() {
  return (
    <Boundary label="page.tsx" animateRerendering={false}>
      <Suspense fallback={<ProductPriceSkeleton />}>
        <ProductPrice productId={DEMO_PRODUCT_ID} />
      </Suspense>
    </Boundary>
  );
}

async function ProductPrice({ productId }: { productId: string }) {
  const price = await getProductPrice(productId);

  return (
    <Boundary label="<ProductPrice> (Cached)" size="small">
      <div className="text-center text-sm">
        <span className="text-gray-400">Price: </span>
        <span className="font-semibold text-green-400">${price}</span>
      </div>
    </Boundary>
  );
}

function ProductPriceSkeleton() {
  return (
    <Boundary
      label="<ProductPrice> (Cached)"
      size="small"
      color="blue"
      animateRerendering={false}
    >
      <div className="text-center text-sm">
        <div className="inline-block h-4 w-24 animate-pulse rounded bg-gray-800" />
      </div>
    </Boundary>
  );
}

// MIGRATION: 'use cache: remote' + cacheTag() → timber.cache() with tags
const getProductPrice = cache(
  async (productId: string) => {
    // DEMO: Add a delay to simulate a database query
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const product = db.product.find({ where: { id: productId } });

    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }

    return product.price;
  },
  {
    tags: (productId: string) => [`product-price-${productId}`, `product-${productId}`],
  },
);
