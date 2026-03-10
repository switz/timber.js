/**
 * Static file serving for production Node.js and Bun adapters.
 *
 * Serves files from the build output's public/ directory with appropriate
 * cache headers. Hashed assets get immutable caching (1 year), unhashed
 * assets get short-lived caching (1 hour).
 *
 * Cloudflare Workers don't need this — their `assets` directory is served
 * by the CDN with automatic caching.
 *
 * Design docs: 18-build-system.md, 06-caching.md
 */

import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { getAssetCacheControl } from '../server/asset-headers.js';

/** Common MIME types for static assets. */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/**
 * Try to serve a static file from the given directory.
 *
 * Returns a Response if the file exists, or null to fall through
 * to the app handler.
 */
export async function serveStaticFile(
  pathname: string,
  publicDir: string
): Promise<Response | null> {
  // Prevent directory traversal
  if (pathname.includes('..') || pathname.includes('\0')) {
    return null;
  }

  // Strip query string
  const cleanPath = pathname.split('?')[0];

  const filePath = join(publicDir, cleanPath);

  // Check if file exists and is a file (not directory)
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return null;
  } catch {
    return null;
  }

  const body = await readFile(filePath);
  const ext = extname(cleanPath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const cacheControl = getAssetCacheControl(cleanPath);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': cacheControl,
    },
  });
}
