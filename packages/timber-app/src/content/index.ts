/**
 * @timber-js/app/content — Public API for content collections.
 *
 * Re-exports from content-collections and provides timber-specific utilities.
 * Users can import directly from 'content-collections' for generated types,
 * or use this module for the re-exports.
 *
 * Design doc: 20-content-collections.md §"Querying Collections"
 */

// Re-export defineCollection and defineConfig for convenience.
// Users can also import these directly from @content-collections/core.
export { defineCollection, defineConfig } from '@content-collections/core';
