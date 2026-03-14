/**
 * Route Element Builder — constructs a React element tree from a matched route.
 *
 * Extracted from rsc-entry.ts to enable reuse by the revalidation renderer
 * (which needs the element tree without RSC serialization) and to keep
 * rsc-entry.ts under the 500-line limit.
 *
 * This module handles:
 * 1. Loading page/layout components from the segment chain
 * 2. Running access.ts checks (DenySignal/RedirectSignal propagate to caller)
 * 3. Resolving metadata (static object or async function, both exported as `metadata`)
 * 4. Building the React element tree (page → error boundaries → access gates → layouts)
 * 5. Resolving parallel slots
 *
 * See design/02-rendering-pipeline.md, design/04-authorization.md
 */

import { createElement } from 'react';

import { withSpan, setSpanAttribute } from './tracing.js';
import type { RouteMatch } from './pipeline.js';
import type { ManifestSegmentNode } from './route-matcher.js';
import { resolveMetadata, renderMetadataToElements } from './metadata.js';
import type { Metadata } from './types.js';
import { DenySignal, RedirectSignal } from './primitives.js';
import { AccessGate } from './access-gate.js';
import { resolveSlotElement } from './slot-resolver.js';
import { SegmentProvider } from '#/client/segment-context.js';
import { setParsedSearchParams } from './request-context.js';
import type { SearchParamsDefinition } from '#/search-params/create.js';
import { wrapSegmentWithErrorBoundaries } from './error-boundary-wrapper.js';
import type { InterceptionContext } from './pipeline.js';

// ─── Types ────────────────────────────────────────────────────────────────

/** Head element for client-side metadata updates. */
export interface HeadElement {
  tag: string;
  content?: string;
  attrs?: Record<string, string | null>;
}

/** Layout entry with component and segment. */
export interface LayoutComponentEntry {
  component: (...args: unknown[]) => unknown;
  segment: ManifestSegmentNode;
}

/** Result of building a route element tree. */
export interface RouteElementResult {
  /** The React element tree (page wrapped in layouts, access gates, error boundaries). */
  element: React.ReactElement;
  /** Resolved head elements for metadata. */
  headElements: HeadElement[];
  /** Layout components loaded along the segment chain. */
  layoutComponents: LayoutComponentEntry[];
  /** Segments from the route match. */
  segments: ManifestSegmentNode[];
  /** Max deferSuspenseFor hold window across all segments. */
  deferSuspenseFor: number;
}

/**
 * Wraps a DenySignal or RedirectSignal with the layout components loaded
 * so far, enabling the caller to render deny pages inside the layout shell.
 */
export class RouteSignalWithContext extends Error {
  constructor(
    public readonly signal: DenySignal | RedirectSignal,
    public readonly layoutComponents: LayoutComponentEntry[],
    public readonly segments: ManifestSegmentNode[]
  ) {
    super(signal.message);
  }
}

// ─── Builder ──────────────────────────────────────────────────────────────

/**
 * Build a React element tree from a matched route.
 *
 * Loads modules, runs access checks, resolves metadata, and constructs
 * the element tree. DenySignal and RedirectSignal propagate to the caller
 * for HTTP-level handling.
 *
 * Does NOT serialize to RSC Flight — the caller decides whether to render
 * to a stream or use the element directly (e.g., for action revalidation).
 */
export async function buildRouteElement(
  req: Request,
  match: RouteMatch,
  interception?: InterceptionContext
): Promise<RouteElementResult> {
  const segments = match.segments as unknown as ManifestSegmentNode[];

  // Params are passed as a Promise to match Next.js 15+ convention.
  const paramsPromise = Promise.resolve(match.params);

  // Load all modules along the segment chain
  const metadataEntries: Array<{ metadata: Metadata; isPage: boolean }> = [];
  const layoutComponents: LayoutComponentEntry[] = [];
  let PageComponent: ((...args: unknown[]) => unknown) | null = null;
  let deferSuspenseFor = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLeaf = i === segments.length - 1;

    // Load layout
    if (segment.layout) {
      const mod = (await segment.layout.load()) as Record<string, unknown>;
      if (mod.default) {
        layoutComponents.push({
          component: mod.default as (...args: unknown[]) => unknown,
          segment,
        });
      }
      // Reject legacy generateMetadata export — use `export async function metadata()` instead
      if ('generateMetadata' in mod) {
        const filePath = segment.layout.filePath ?? segment.urlPath;
        throw new Error(
          `${filePath}: "generateMetadata" is not a valid export. ` +
            `Export an async function named "metadata" instead.\n\n` +
            `  // Before\n` +
            `  export async function generateMetadata({ params }) { ... }\n\n` +
            `  // After\n` +
            `  export async function metadata({ params }) { ... }`
        );
      }
      // Unified metadata export: static object or async function
      if (typeof mod.metadata === 'function') {
        type MetadataFn = (props: Record<string, unknown>) => Promise<Metadata>;
        const generated = await withSpan(
          'timber.metadata',
          { 'timber.segment': segment.segmentName ?? segment.urlPath },
          () => (mod.metadata as MetadataFn)({ params: paramsPromise })
        );
        if (generated) {
          metadataEntries.push({ metadata: generated, isPage: false });
        }
      } else if (mod.metadata) {
        metadataEntries.push({ metadata: mod.metadata as Metadata, isPage: false });
      }
      // deferSuspenseFor hold window — max across all segments
      if (typeof mod.deferSuspenseFor === 'number' && mod.deferSuspenseFor > deferSuspenseFor) {
        deferSuspenseFor = mod.deferSuspenseFor;
      }
    }

    // Load page (leaf segment only)
    if (isLeaf && segment.page) {
      // Load and apply search-params.ts definition before rendering so
      // searchParams() from @timber/app/server returns parsed typed values.
      if (segment.searchParams) {
        const spMod = (await segment.searchParams.load()) as {
          default?: SearchParamsDefinition<Record<string, unknown>>;
        };
        if (spMod.default) {
          const rawSearchParams = new URL(req.url).searchParams;
          const parsed = spMod.default.parse(rawSearchParams);
          setParsedSearchParams(parsed);
        }
      }

      const mod = (await segment.page.load()) as Record<string, unknown>;
      if (mod.default) {
        PageComponent = mod.default as (...args: unknown[]) => unknown;
      }
      // Reject legacy generateMetadata export — use `export async function metadata()` instead
      if ('generateMetadata' in mod) {
        const filePath = segment.page.filePath ?? segment.urlPath;
        throw new Error(
          `${filePath}: "generateMetadata" is not a valid export. ` +
            `Export an async function named "metadata" instead.\n\n` +
            `  // Before\n` +
            `  export async function generateMetadata({ params }) { ... }\n\n` +
            `  // After\n` +
            `  export async function metadata({ params }) { ... }`
        );
      }
      // Unified metadata export: static object or async function
      if (typeof mod.metadata === 'function') {
        type MetadataFn = (props: Record<string, unknown>) => Promise<Metadata>;
        const generated = await withSpan(
          'timber.metadata',
          { 'timber.segment': segment.segmentName ?? segment.urlPath },
          () => (mod.metadata as MetadataFn)({ params: paramsPromise })
        );
        if (generated) {
          metadataEntries.push({ metadata: generated, isPage: true });
        }
      } else if (mod.metadata) {
        metadataEntries.push({ metadata: mod.metadata as Metadata, isPage: true });
      }
      // deferSuspenseFor hold window — max across all segments
      if (typeof mod.deferSuspenseFor === 'number' && mod.deferSuspenseFor > deferSuspenseFor) {
        deferSuspenseFor = mod.deferSuspenseFor;
      }
    }
  }

  if (!PageComponent) {
    throw new Error(`No page component found for route: ${new URL(req.url).pathname}`);
  }

  // Run access.ts checks before rendering — top-down through the segment chain.
  // DenySignal and RedirectSignal are wrapped with layout context so the caller
  // can render deny pages inside the layout shell.
  // See design/04-authorization.md §"access.ts Runs on Every Navigation".
  for (const segment of segments) {
    if (segment.access) {
      const accessMod = (await segment.access.load()) as Record<string, unknown>;
      const accessFn = accessMod.default as
        | ((ctx: { params: Record<string, string | string[]>; searchParams: unknown }) => unknown)
        | undefined;
      if (accessFn) {
        try {
          await withSpan(
            'timber.access',
            { 'timber.segment': segment.segmentName ?? 'unknown' },
            async () => {
              try {
                await accessFn({ params: match.params, searchParams: {} });
                await setSpanAttribute('timber.result', 'pass');
              } catch (error) {
                if (error instanceof DenySignal) {
                  await setSpanAttribute('timber.result', 'deny');
                  await setSpanAttribute('timber.deny_status', error.status);
                  if (error.sourceFile) {
                    await setSpanAttribute('timber.deny_file', error.sourceFile);
                  }
                } else if (error instanceof RedirectSignal) {
                  await setSpanAttribute('timber.result', 'redirect');
                }
                throw error;
              }
            }
          );
        } catch (error) {
          if (error instanceof DenySignal || error instanceof RedirectSignal) {
            throw new RouteSignalWithContext(error, layoutComponents, segments);
          }
          throw error;
        }
      }
    }
  }

  // Resolve metadata
  const resolvedMetadata = resolveMetadata(metadataEntries);
  const headElements = renderMetadataToElements(resolvedMetadata);

  // Build element tree: page wrapped in layouts (innermost to outermost)
  const h = createElement as (...args: unknown[]) => React.ReactElement;

  // Wrap the page component in an OTEL span
  const TracedPage = async (props: Record<string, unknown>) => {
    return withSpan(
      'timber.page',
      { 'timber.route': match.segments[match.segments.length - 1]?.urlPath ?? '/' },
      () => (PageComponent as (props: Record<string, unknown>) => unknown)(props)
    );
  };

  let element = h(TracedPage, {
    params: paramsPromise,
    searchParams: {},
  });

  // Build a lookup of layout components by segment for O(1) access.
  const layoutBySegment = new Map(
    layoutComponents.map(({ component, segment }) => [segment, component])
  );

  // Wrap from innermost (leaf) to outermost (root), processing every
  // segment in the chain. Each segment may contribute:
  //   1. Error boundaries (status files + error.tsx)
  //   2. Layout component — wraps children + parallel slots
  //   3. SegmentProvider — records position for useSelectedLayoutSegment
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];

    // Wrap with error boundaries from this segment (inside layout).
    element = await wrapSegmentWithErrorBoundaries(segment, element, h);

    // Wrap in AccessGate if segment has access.ts.
    if (segment.access) {
      const accessMod = (await segment.access.load()) as Record<string, unknown>;
      const accessFn = accessMod.default as
        | ((ctx: { params: Record<string, string | string[]>; searchParams: unknown }) => unknown)
        | undefined;
      if (accessFn) {
        element = h(AccessGate, {
          accessFn,
          params: match.params,
          searchParams: {},
          segmentName: segment.segmentName,
          children: element,
        });
      }
    }

    // Wrap with layout if this segment has one — traced with OTEL span
    const layoutComponent = layoutBySegment.get(segment);
    if (layoutComponent) {
      // Resolve parallel slots for this layout
      const slotProps: Record<string, unknown> = {};
      const slotEntries = Object.entries(segment.slots ?? {});
      for (const [slotName, slotNode] of slotEntries) {
        slotProps[slotName] = await resolveSlotElement(
          slotNode as ManifestSegmentNode,
          match,
          paramsPromise,
          h,
          interception
        );
      }

      const segmentPath = segment.urlPath.split('/');
      const parallelRouteKeys = Object.keys(segment.slots ?? {});

      // Wrap the layout component in an OTEL span
      const segmentForSpan = segment;
      const layoutComponentForSpan = layoutComponent;
      const TracedLayout = async (props: Record<string, unknown>) => {
        return withSpan('timber.layout', { 'timber.segment': segmentForSpan.urlPath }, () =>
          (layoutComponentForSpan as (props: Record<string, unknown>) => unknown)(props)
        );
      };

      element = h(SegmentProvider, {
        segments: segmentPath,
        parallelRouteKeys,
        children: h(TracedLayout, {
          ...slotProps,
          params: paramsPromise,
          searchParams: {},
          children: element,
        }),
      });
    }
  }

  return {
    element,
    headElements: headElements as HeadElement[],
    layoutComponents,
    segments,
    deferSuspenseFor,
  };
}
