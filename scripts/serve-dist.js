#!/usr/bin/env node

/**
 * Serve the production demo build for E2E tests (Playwright's webServer on CI).
 *
 * Usage: node scripts/serve-dist.js   (expects dist/dnd/browser: npm run build:lib && npm run build)
 *
 * Production bundles load much faster than `ng serve`'s unoptimized dev bundles, and on CI the
 * build job has already produced them. Paths without a file extension fall back to index.html
 * (the demo is an SPA). CI builds with the GitHub Pages base href (/ngx-virtual-dnd/demo/); the
 * bundle is otherwise base-agnostic, so swapping the <base> tag lets tests navigate from /.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4200);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'dist/dnd/browser');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

if (!existsSync(join(buildDir, 'index.html'))) {
  console.error(
    'serve-dist: dist/dnd/browser not found. Run `npm run build:lib && npm run build`.',
  );
  process.exit(1);
}

const indexHtml = readFileSync(join(buildDir, 'index.html'), 'utf8').replace(
  /<base href="[^"]*"/,
  '<base href="/"',
);

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!extname(pathname)) {
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'] });
      response.end(indexHtml);
      return;
    }

    const file = join(buildDir, pathname);
    if (!file.startsWith(buildDir + sep)) {
      throw new Error('outside the build directory');
    }
    const body = await readFile(file);
    const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': CONTENT_TYPES['.txt'] });
    response.end('Not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`serve-dist: serving dist/dnd/browser at http://${HOST}:${PORT}/`);
});
