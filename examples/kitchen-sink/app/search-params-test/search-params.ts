import { createSearchParams, fromSchema } from '@timber/app/search-params';
import * as v from 'valibot';

export default createSearchParams(
  {
    page: fromSchema(
      v.pipe(
        v.unknown(),
        v.transform((val) => {
          if (val === undefined || val === null || val === '') return 1;
          const num = Number(val);
          return Number.isNaN(num) || !Number.isInteger(num) || num < 1 ? 1 : num;
        }),
        v.number()
      )
    ),
    q: fromSchema(
      v.pipe(
        v.unknown(),
        v.transform((val) => {
          if (val === undefined || val === null || val === '') return null;
          return String(val);
        }),
        v.nullable(v.string())
      )
    ),
    sort: fromSchema(
      v.pipe(
        v.unknown(),
        v.transform((val) => {
          const valid = ['relevance', 'price-asc', 'price-desc', 'newest'] as const;
          if (typeof val === 'string' && (valid as readonly string[]).includes(val)) {
            return val as (typeof valid)[number];
          }
          return 'relevance' as const;
        }),
        v.picklist(['relevance', 'price-asc', 'price-desc', 'newest'])
      )
    ),
  },
  {
    urlKeys: { page: 'pg', sort: 's' },
  }
);
