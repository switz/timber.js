// @timber/app/client — Client-side primitives
// These are the primary imports for client components.

export type { RenderErrorDigest } from './types';

// Navigation
export { Link } from './link';
export type { LinkProps } from './link';
export { createRouter } from './router';
export type { RouterInstance, NavigationOptions, RouterDeps } from './router';

// Segment cache (internal, but exported for advanced use)
export { SegmentCache, PrefetchCache } from './segment-cache';
export type { SegmentNode, StateTree } from './segment-cache';

// History (internal, but exported for advanced use)
export { HistoryStack } from './history';
export type { HistoryEntry } from './history';

// Forms
export { useActionState, useFormAction } from './form';
export type { UseActionStateFn, UseActionStateReturn } from './form';

// Params
export { useParams, setCurrentParams } from './use-params';
