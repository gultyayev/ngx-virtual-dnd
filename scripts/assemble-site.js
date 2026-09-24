#!/usr/bin/env node

/**
 * Assemble the GitHub Pages site: Rspress docs at the root, the Angular demo under /demo/.
 *
 * Usage: npm run site:build   (builds the library, demo and docs, then runs this script)
 *
 * Expects:
 * - dist/site          Rspress output (npm run docs:build)
 * - dist/dnd/browser   Demo built with --base-href /ngx-virtual-dnd/demo/ (npm run build:demo:pages)
 *
 * GitHub Pages has no SPA fallback, so a deep link such as /demo/page-scroll would 404.
 * For every Angular route this script writes a copy of the demo's index.html at
 * demo/<route>/index.html. Routes are read from src/app/app.routes.ts and, for the docs
 * live examples, src/app/examples/examples.routes.ts (mounted under /examples).
 *
 * The demo used to live at the site root, so each top-level demo route also gets a small
 * redirect page at its old URL (for example /page-scroll → /demo/page-scroll).
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = '/ngx-virtual-dnd/';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(root, 'dist/site');
const demoBuildDir = join(root, 'dist/dnd/browser');
const demoDir = join(siteDir, 'demo');

/** Static `path: '...'` values of a routes file, excluding the empty (index) route. */
function readRoutePaths(file) {
  const source = readFileSync(join(root, file), 'utf8');
  return [...source.matchAll(/path:\s*(['"`])([^'"`]*)\1/g)]
    .map((match) => match[2])
    .filter(Boolean);
}

function fail(message) {
  console.error(`assemble-site: ${message}`);
  process.exit(1);
}

if (!existsSync(join(siteDir, 'index.html'))) {
  fail('dist/site/index.html is missing. Run `npm run docs:build` first.');
}
const demoIndexPath = join(demoBuildDir, 'index.html');
if (!existsSync(demoIndexPath)) {
  fail('dist/dnd/browser/index.html is missing. Run `npm run build:demo:pages` first.');
}

const demoIndex = readFileSync(demoIndexPath, 'utf8');
if (!demoIndex.includes(`<base href="${BASE}demo/"`)) {
  fail(`the demo was not built with --base-href ${BASE}demo/.`);
}

const appRoutes = readRoutePaths('src/app/app.routes.ts');
const exampleRoutes = readRoutePaths('src/app/examples/examples.routes.ts');
if (appRoutes.length === 0 || exampleRoutes.length === 0) {
  fail('route extraction found no routes; check the routes files.');
}
const routes = [...appRoutes, ...exampleRoutes.map((path) => `examples/${path}`)];

cpSync(demoBuildDir, demoDir, { recursive: true });

for (const route of routes) {
  const routeDir = join(demoDir, route);
  mkdirSync(routeDir, { recursive: true });
  writeFileSync(join(routeDir, 'index.html'), demoIndex);
}

// Redirects from the demo's pre-docs URLs (it used to be served at the site root).
const legacyRoutes = appRoutes.filter((route) => route !== 'examples');
for (const route of legacyRoutes) {
  const legacyDir = join(siteDir, route);
  const legacyIndex = join(legacyDir, 'index.html');
  const isOwnRedirect =
    existsSync(legacyIndex) && readFileSync(legacyIndex, 'utf8').includes('The demo moved to');
  if ((existsSync(legacyIndex) && !isOwnRedirect) || existsSync(`${legacyDir}.html`)) {
    fail(`a docs page already exists at /${route}; cannot add a demo redirect there.`);
  }
  const target = `${BASE}demo/${route}`;
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(
    join(legacyDir, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Moved</title>` +
      `<link rel="canonical" href="${target}"><meta http-equiv="refresh" content="0; url=${target}">` +
      `<p>The demo moved to <a href="${target}">${target}</a>.</p>\n`,
  );
}

console.log(
  `assemble-site: demo copied to dist/site/demo with ${routes.length} route entry points:`,
);
for (const route of routes) {
  console.log(`  /demo/${route}`);
}
console.log(`assemble-site: ${legacyRoutes.length} redirects from pre-docs demo URLs`);
