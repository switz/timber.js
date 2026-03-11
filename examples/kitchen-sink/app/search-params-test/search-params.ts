import { createSearchParams, fromSchema } from '@timber/app/search-params';
import { z } from 'zod/v4';

export default createSearchParams(
  {
    page: fromSchema(z.coerce.number().int().min(1).default(1)),
    q: fromSchema(z.string().nullable().default(null)),
    sort: fromSchema(
      z.enum(['relevance', 'price-asc', 'price-desc', 'newest']).default('relevance')
    ),
  },
  {
    urlKeys: { page: 'pg', sort: 's' },
  }
);
