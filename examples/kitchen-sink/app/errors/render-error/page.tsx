import { RenderError } from '@timber/app/server';

// Throws a RenderError with typed digest — caught by root error.tsx.
// Per design/10-error-handling.md, RenderError carries a plain-data digest
// alongside the error, and error.tsx receives it as the `digest` prop.
export default function RenderErrorPage() {
  throw new RenderError('PRODUCT_NOT_FOUND', {
    title: 'Product not found',
    resourceId: 'abc-123',
  });
}
