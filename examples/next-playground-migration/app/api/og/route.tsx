// MIGRATION: next/og (ImageResponse) and next/server (NextRequest) are
// Vercel-specific APIs not available in timber.js on Cloudflare Workers.
//
// The original OG image generation used @vercel/og which renders React
// components to images via the Vercel Edge Runtime (Satori).
//
// timber.js equivalent options:
// 1. Use a third-party image generation service (Cloudinary, etc.)
// 2. Implement using Satori directly (https://github.com/vercel/satori)
//    which runs in any Web API environment including Cloudflare Workers
// 3. Serve a static OG image from /public/
//
// Gap filed: see bd issue for adding Satori-based OG image support.
//
// For now, this route returns a placeholder SVG response.

import type { RouteContext } from '@timber-js/app/server';

export async function GET(ctx: RouteContext): Promise<Response> {
  const title = ctx.searchParams.get('title') ?? 'timber.js Playground';

  // Simple SVG placeholder — replace with Satori for production
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="843" height="441">
    <rect width="843" height="441" fill="black"/>
    <text x="421" y="220" font-size="48" font-family="sans-serif"
          fill="white" text-anchor="middle" dominant-baseline="middle">
      ${title.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c)}
    </text>
  </svg>`;

  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
  });
}
