/**
 * Metadata route helpers for the request pipeline.
 *
 * Handles serving static metadata files and serializing sitemap responses.
 * Extracted from pipeline.ts to keep files under 500 lines.
 *
 * See design/16-metadata.md §"Metadata Routes"
 */

import { readFile } from 'node:fs/promises';

/**
 * Content types that are text-based and should include charset=utf-8.
 * Binary formats (images) should not include charset.
 */
const TEXT_CONTENT_TYPES = new Set([
  'application/xml',
  'text/plain',
  'application/json',
  'application/manifest+json',
  'image/svg+xml',
]);

/**
 * Serve a static metadata file by reading it from disk.
 *
 * Static metadata route files (.xml, .txt, .json, .png, .ico, .svg, etc.)
 * are served as-is with the appropriate Content-Type header.
 * Text files include charset=utf-8; binary files do not.
 *
 * See design/16-metadata.md §"Metadata Routes"
 */
export async function serveStaticMetadataFile(
  metaMatch: import('./route-matcher.js').MetadataRouteMatch
): Promise<Response> {
  const { contentType, file } = metaMatch;
  const isText = TEXT_CONTENT_TYPES.has(contentType);

  const body = await readFile(file.filePath);

  const headers: Record<string, string> = {
    'Content-Type': isText ? `${contentType}; charset=utf-8` : contentType,
    'Content-Length': String(body.byteLength),
  };

  return new Response(body, { status: 200, headers });
}

/**
 * Serialize a sitemap array to XML.
 * Follows the sitemap.org protocol: https://www.sitemaps.org/protocol.html
 */
export function serializeSitemap(
  entries: Array<{
    url: string;
    lastModified?: string | Date;
    changeFrequency?: string;
    priority?: number;
  }>
): string {
  const urls = entries
    .map((e) => {
      let xml = `  <url>\n    <loc>${escapeXml(e.url)}</loc>`;
      if (e.lastModified) {
        const date = e.lastModified instanceof Date ? e.lastModified.toISOString() : e.lastModified;
        xml += `\n    <lastmod>${escapeXml(date)}</lastmod>`;
      }
      if (e.changeFrequency) {
        xml += `\n    <changefreq>${escapeXml(e.changeFrequency)}</changefreq>`;
      }
      if (e.priority !== undefined) {
        xml += `\n    <priority>${e.priority}</priority>`;
      }
      xml += '\n  </url>';
      return xml;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

/** Escape special XML characters. */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
