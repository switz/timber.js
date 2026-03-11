/**
 * Element tree construction for timber.js rendering.
 *
 * Builds a unified React element tree from a matched segment chain, bottom-up:
 *   page → status-code error boundaries → access gates → layout → repeat up segment chain
 *
 * The tree is rendered via a single `renderToReadableStream` call,
 * giving one `React.cache` scope for the entire route.
 *
 * See design/02-rendering-pipeline.md §"Element Tree Construction"
 */

import type { SegmentNode, RouteFile } from '../routing/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A loaded module for a route file convention. */
export interface LoadedModule {
  /** The default export (component, access function, etc.) */
  default?: unknown;
  /** Named exports (for route.ts method handlers, metadata, etc.) */
  [key: string]: unknown;
}

/** Function that loads a route file's module. */
export type ModuleLoader = (file: RouteFile) => LoadedModule | Promise<LoadedModule>;

/** A React element — kept opaque to avoid a React dependency in this module. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReactElement = any;

/** Function that creates a React element. Matches React.createElement signature. */
export type CreateElement = (
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
) => ReactElement;

/**
 * Resolved slot content for a layout.
 * Key is slot name (without @), value is the element tree for that slot.
 */
export type SlotElements = Map<string, ReactElement>;

/** Configuration for the tree builder. */
export interface TreeBuilderConfig {
  /** The matched segment chain from root to leaf. */
  segments: SegmentNode[];
  /** Route params extracted by the matcher. */
  params: Record<string, string>;
  /** Parsed search params (typed or URLSearchParams). */
  searchParams: unknown;
  /** Loads a route file's module. */
  loadModule: ModuleLoader;
  /** React.createElement or equivalent. */
  createElement: CreateElement;
}

// ─── Component wrappers ──────────────────────────────────────────────────────

/**
 * Framework-injected access gate component.
 * Async server component that calls access.ts before rendering children.
 */
export interface AccessGateProps {
  accessFn: (ctx: { params: Record<string, string>; searchParams: unknown }) => unknown;
  params: Record<string, string>;
  searchParams: unknown;
  /** Segment name for dev logging (e.g. "authenticated", "dashboard"). */
  segmentName?: string;
  children: ReactElement;
}

/**
 * Framework-injected slot access gate component.
 * On denial, renders denied.tsx → default.tsx → null instead of failing the page.
 */
export interface SlotAccessGateProps {
  accessFn: (ctx: { params: Record<string, string>; searchParams: unknown }) => unknown;
  params: Record<string, string>;
  searchParams: unknown;
  deniedFallback: ReactElement | null;
  defaultFallback: ReactElement | null;
  children: ReactElement;
}

/**
 * Framework-injected error boundary wrapper.
 * Wraps content with status-code error boundary handling.
 */
export interface ErrorBoundaryProps {
  fallbackComponent: ReactElement | null;
  status?: number;
  children: ReactElement;
}

// ─── Tree Builder ────────────────────────────────────────────────────────────

/**
 * Result of building the element tree.
 */
export interface TreeBuildResult {
  /** The root React element tree ready for renderToReadableStream. */
  tree: ReactElement;
  /** Whether the leaf segment is a route.ts (API endpoint) rather than a page. */
  isApiRoute: boolean;
}

/**
 * Build the unified element tree from a matched segment chain.
 *
 * Construction is bottom-up:
 *   1. Start with the page component (leaf segment)
 *   2. Wrap in status-code error boundaries (fallback chain)
 *   3. Wrap in AccessGate (if segment has access.ts)
 *   4. Pass as children to the segment's layout
 *   5. Repeat up the segment chain to root
 *
 * Parallel slots are resolved at each layout level and composed as named props.
 */
export async function buildElementTree(config: TreeBuilderConfig): Promise<TreeBuildResult> {
  const { segments, params, searchParams, loadModule, createElement } = config;

  if (segments.length === 0) {
    throw new Error('[timber] buildElementTree: empty segment chain');
  }

  const leaf = segments[segments.length - 1];

  // API routes (route.ts) don't build a React tree
  if (leaf.route && !leaf.page) {
    return { tree: null, isApiRoute: true };
  }

  // Start with the page component
  const pageModule = leaf.page ? await loadModule(leaf.page) : null;
  const PageComponent = pageModule?.default as ((...args: unknown[]) => ReactElement) | undefined;

  if (!PageComponent) {
    throw new Error(
      `[timber] No page component found for route at ${leaf.urlPath}. ` +
        'Each route must have a page.tsx or route.ts.'
    );
  }

  // Build the page element with params and searchParams props
  let element: ReactElement = createElement(PageComponent, { params, searchParams });

  // Build tree bottom-up: wrap page, then walk segments from leaf to root
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];

    // Wrap in error boundaries (status-code files + error.tsx)
    element = await wrapWithErrorBoundaries(segment, element, loadModule, createElement);

    // Wrap in AccessGate if segment has access.ts
    if (segment.access) {
      const accessModule = await loadModule(segment.access);
      const accessFn = accessModule.default as AccessGateProps['accessFn'];
      element = createElement('timber:access-gate', {
        accessFn,
        params,
        searchParams,
        segmentName: segment.segmentName,
        children: element,
      } satisfies AccessGateProps);
    }

    // Wrap in layout (if exists and not the leaf's page-level wrapping)
    if (segment.layout) {
      const layoutModule = await loadModule(segment.layout);
      const LayoutComponent = layoutModule.default as
        | ((...args: unknown[]) => ReactElement)
        | undefined;

      if (LayoutComponent) {
        // Resolve parallel slots for this layout
        const slotProps: Record<string, ReactElement> = {};
        if (segment.slots.size > 0) {
          for (const [slotName, slotNode] of segment.slots) {
            slotProps[slotName] = await buildSlotElement(
              slotNode,
              params,
              searchParams,
              loadModule,
              createElement
            );
          }
        }

        element = createElement(LayoutComponent, {
          ...slotProps,
          params,
          searchParams,
          children: element,
        });
      }
    }
  }

  return { tree: element, isApiRoute: false };
}

// ─── Slot Element Builder ────────────────────────────────────────────────────

/**
 * Build the element tree for a parallel slot.
 *
 * Slots have their own access.ts (SlotAccessGate) and error boundaries.
 * On access denial: denied.tsx → default.tsx → null (graceful degradation).
 */
async function buildSlotElement(
  slotNode: SegmentNode,
  params: Record<string, string>,
  searchParams: unknown,
  loadModule: ModuleLoader,
  createElement: CreateElement
): Promise<ReactElement> {
  // Load slot page
  const pageModule = slotNode.page ? await loadModule(slotNode.page) : null;
  const PageComponent = pageModule?.default as ((...args: unknown[]) => ReactElement) | undefined;

  // Load default.tsx fallback
  const defaultModule = slotNode.default ? await loadModule(slotNode.default) : null;
  const DefaultComponent = defaultModule?.default as
    | ((...args: unknown[]) => ReactElement)
    | undefined;

  // If no page, render default.tsx or null
  if (!PageComponent) {
    return DefaultComponent ? createElement(DefaultComponent, { params, searchParams }) : null;
  }

  let element: ReactElement = createElement(PageComponent, { params, searchParams });

  // Wrap in error boundaries
  element = await wrapWithErrorBoundaries(slotNode, element, loadModule, createElement);

  // Wrap in SlotAccessGate if slot has access.ts
  if (slotNode.access) {
    const accessModule = await loadModule(slotNode.access);
    const accessFn = accessModule.default as SlotAccessGateProps['accessFn'];

    // Load denied.tsx
    const deniedModule = slotNode.denied ? await loadModule(slotNode.denied) : null;
    const DeniedComponent = deniedModule?.default as
      | ((...args: unknown[]) => ReactElement)
      | undefined;

    const deniedFallback = DeniedComponent
      ? createElement(DeniedComponent, {
          slot: slotNode.segmentName.replace(/^@/, ''),
          dangerouslyPassData: undefined,
        })
      : null;
    const defaultFallback = DefaultComponent
      ? createElement(DefaultComponent, { params, searchParams })
      : null;

    element = createElement('timber:slot-access-gate', {
      accessFn,
      params,
      searchParams,
      deniedFallback,
      defaultFallback,
      children: element,
    } satisfies SlotAccessGateProps);
  }

  return element;
}

// ─── Error Boundary Wrapping ─────────────────────────────────────────────────

/**
 * Wrap an element with error boundaries from a segment's status-code files.
 *
 * Wrapping order (innermost to outermost):
 *   1. Specific status files (503.tsx, 429.tsx, etc.)
 *   2. Category catch-alls (4xx.tsx, 5xx.tsx)
 *   3. error.tsx (general error boundary)
 *
 * This creates the fallback chain described in design/10-error-handling.md.
 */
async function wrapWithErrorBoundaries(
  segment: SegmentNode,
  element: ReactElement,
  loadModule: ModuleLoader,
  createElement: CreateElement
): Promise<ReactElement> {
  // Wrapping is applied inside-out. The last wrap call produces the outermost boundary.
  // Order: specific status → category → error.tsx (outermost)

  if (segment.statusFiles) {
    // Wrap with specific status files (innermost — highest priority at runtime)
    for (const [key, file] of segment.statusFiles) {
      if (key !== '4xx' && key !== '5xx') {
        const status = parseInt(key, 10);
        if (!isNaN(status)) {
          const mod = await loadModule(file);
          const Component = mod.default;
          if (Component) {
            element = createElement('timber:error-boundary', {
              fallbackComponent: Component,
              status,
              children: element,
            } satisfies ErrorBoundaryProps);
          }
        }
      }
    }

    // Wrap with category catch-alls (4xx.tsx, 5xx.tsx)
    for (const [key, file] of segment.statusFiles) {
      if (key === '4xx' || key === '5xx') {
        const mod = await loadModule(file);
        const Component = mod.default;
        if (Component) {
          element = createElement('timber:error-boundary', {
            fallbackComponent: Component,
            status: key === '4xx' ? 400 : 500, // category marker
            children: element,
          } satisfies ErrorBoundaryProps);
        }
      }
    }
  }

  // Wrap with error.tsx (outermost — catches anything not matched by status files)
  if (segment.error) {
    const errorModule = await loadModule(segment.error);
    const ErrorComponent = errorModule.default;
    if (ErrorComponent) {
      element = createElement('timber:error-boundary', {
        fallbackComponent: ErrorComponent,
        children: element,
      } satisfies ErrorBoundaryProps);
    }
  }

  return element;
}
