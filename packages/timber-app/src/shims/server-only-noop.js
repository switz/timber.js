// oxlint-disable
// No-op shim for server-only/client-only packages.
// In dev mode, Vite externalizes node_modules and loads them via Node's
// require(). Deps like `bright` that import `server-only` would hit the
// real CJS package which throws. This shim replaces it with a no-op
// in server environments (RSC/SSR) where the import is always safe.
