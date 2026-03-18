// MIGRATION: cacheTag() from next/cache is replaced by timber.cache() tags option.
// In Next.js, cacheTag() inside 'use cache' functions sets invalidation tags.
// In timber, tags are passed as options to timber.cache().
//
// Before (Next.js):
//   async function getProducts() {
//     'use cache';
//     cacheTag('products');
//     ...
//   }
//
// After (timber):
//   const getProducts = createCache(async () => { ... }, { tags: ['products'] })
import db from '#/lib/db';
import { Boundary } from '#/ui/boundary';
import { ProductCard } from '#/ui/product-card';
import { createCache } from '@timber-js/app/cache';
import SessionButton from './session-button';
import ProductLink from './product-link';

export async function ProductList() {
  const products = await getProducts();

  return (
    <Boundary label="<ProductList> (statically inferred)" size="small" animateRerendering={false}>
      <div className="flex flex-col gap-4">
        <div className="flex justify-between">
          <h1 className="text-xl font-semibold text-gray-300">
            Available Products{' '}
            <span className="font-mono tracking-tighter text-gray-600">({products.length})</span>
          </h1>

          <div className="flex">
            <SessionButton />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {products.map((product, index) => {
            // First half uses private cache (with runtime prefetch)
            // Second half uses regular cache (no prefetch)
            const privateCache = index < products.length / 2;

            return (
              <ProductLink
                href={
                  privateCache
                    ? `/private-cache/product/${product.id}/with-private`
                    : `/private-cache/product/${product.id}/without-private`
                }
                privateCache={privateCache}
                key={product.id}
              >
                <ProductCard product={product} animateEnter={true} />
              </ProductLink>
            );
          })}
        </div>
      </div>
    </Boundary>
  );
}

export function ProductListSkeleton() {
  return (
    <Boundary
      label="<ProductList> (statically inferred)"
      size="small"
      color="blue"
      animateRerendering={false}
    >
      <div className="flex flex-col gap-4">
        <div className="h-24 animate-pulse rounded-lg bg-gray-800" />
        <h1 className="text-xl font-semibold text-gray-300">Available Products</h1>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg bg-gray-800" />
          ))}
        </div>
      </div>
    </Boundary>
  );
}

// MIGRATION: 'use cache' + cacheTag() → timber.cache() with tags option
const getProducts = createCache(
  async () => {
    // DEMO: Add a delay to simulate a slow data request
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return db.product.findMany({ limit: 4 });
  },
  {
    // Tags from cacheTag('products') + per-product tags
    // Note: timber.cache tags are static here; for per-item tags use the
    // tags function form: tags: (result) => result.map(p => `product-${p.id}`)
    // However, timber.cache tags run at call time, not after execution.
    // Per-product tags could be added by wrapping individual product fetches.
    tags: ['products'],
  }
);
