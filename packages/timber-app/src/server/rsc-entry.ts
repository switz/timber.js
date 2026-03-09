/**
 * RSC Entry — Request handler for the RSC environment.
 *
 * This is a real TypeScript file, not codegen. It imports the route
 * manifest from a virtual module and creates the request handler.
 *
 * Design docs: 18-build-system.md §"Entry Files", 02-rendering-pipeline.md
 */

// @ts-expect-error — virtual module provided by timber-routing plugin
import routeManifest from 'virtual:timber-route-manifest';
// @ts-expect-error — virtual module provided by timber-entries plugin
import config from 'virtual:timber-config';

import { createPipeline } from './pipeline.js';
import type { PipelineConfig } from './pipeline.js';

/**
 * Create the RSC request handler from the route manifest.
 *
 * The pipeline handles: proxy.ts → canonicalize → route match →
 * 103 Early Hints → middleware.ts → render.
 */
function createRequestHandler(manifest: typeof routeManifest, _runtimeConfig: typeof config) {
  // TODO: Build RouteMatcher from manifest, wire RouteRenderer,
  // and compose the full PipelineConfig. This will be filled in
  // as the rendering pipeline matures.
  const pipelineConfig: PipelineConfig = {
    proxy: manifest.proxy?.load,
    matchRoute: (_pathname: string) => null,
    render: async (_req: Request) => new Response('Not implemented', { status: 501 }),
  };

  const pipeline = createPipeline(pipelineConfig);
  return pipeline;
}

export default createRequestHandler(routeManifest, config);
