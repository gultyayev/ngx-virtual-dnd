#!/usr/bin/env node

/**
 * Render the docs' social preview image, docs/pages/public/og-image.png (1280x640).
 *
 * Usage: node scripts/og-image.mjs
 *
 * The card is the home hero on the Night design system's dark theme: the lockup, the headline
 * with its highlight, the tagline's first sentence and the install command (all read from the
 * `hero` frontmatter of docs/pages/index.mdx), and the hero's Backlog art. Tokens come from
 * src/styles/tokens.css; Geist and Geist Mono are embedded from @fontsource-variable, so the
 * render needs no network. Uses the Playwright Chromium the E2E setup installs.
 *
 * Rerun after changing the hero copy, the hero art or the tokens.
 */

import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/pages/public/og-image.png');
const WIDTH = 1280;
const HEIGHT = 640;

/** One `hero.<key>` value from the home page frontmatter. */
function heroField(key) {
  const source = readFileSync(join(root, 'docs/pages/index.mdx'), 'utf8');
  const match = new RegExp(`^  ${key}: (.+)$`, 'm').exec(source);
  if (!match) {
    throw new Error(`docs/pages/index.mdx has no hero.${key}`);
  }
  return match[1].trim().replace(/^'(.*)'$/, '$1');
}

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const title = heroField('text');
const highlight = heroField('highlight');
const tagline = heroField('tagline').split(/(?<=\.)\s/)[0];
const install = heroField('install');
if (!title.endsWith(highlight)) {
  throw new Error(`hero.highlight ("${highlight}") must end hero.text ("${title}")`);
}
const lead = title.slice(0, title.length - highlight.length).trim();

const font = (family, file) => {
  const data = readFileSync(join(root, 'node_modules/@fontsource-variable', family, 'files', file));
  return `url(data:font/woff2;base64,${data.toString('base64')}) format('woff2')`;
};

const grip = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/>
  <circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>
</svg>`;
const virtualRow = (n) =>
  `<div class="art__virtual">Task ${n}<span class="art__tag">virtual</span></div>`;
// The hero art at rest: Task 43 lifted over its own slot (index 2), the other rows around it.
const row = (n, i) => `<div class="art__row" style="--i: ${i}">${grip}<span>Task ${n}</span></div>`;

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<style>
@font-face { font-family: 'Geist'; font-weight: 100 900; src: ${font('geist', 'geist-latin-wght-normal.woff2')}; }
@font-face { font-family: 'Geist Mono'; font-weight: 100 900; src: ${font('geist-mono', 'geist-mono-latin-wght-normal.woff2')}; }
${readFileSync(join(root, 'src/styles/tokens.css'), 'utf8')}
* { box-sizing: border-box; margin: 0; }
html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
body {
  background: var(--page);
  color: var(--ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
.og { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
/* The hero ground: the 56px grid around the art and the two glows behind it. */
.og::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-position: -1px -1px;
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 62% 78% at 74% 46%, #000 15%, transparent 72%);
}
.og::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(560px 420px at 76% 52%, var(--glow-a), transparent 70%),
    radial-gradient(480px 340px at 98% 8%, var(--glow-b), transparent 70%);
}
.text {
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  left: 80px;
  width: 590px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
}
.lockup { display: flex; align-items: center; gap: 12px; font: 600 25px/1 var(--font-sans); letter-spacing: -0.02em; }
.mark { width: 34px; height: 34px; }
.mark__ghost { fill: var(--ink); opacity: 0.25; }
.mark__row { fill: var(--ink); }
.mark__held { fill: var(--held); }
.mark__frame { fill: none; stroke: var(--accent); stroke-width: 1.6; }
.title { margin-top: 46px; font: 620 74px/1.02 var(--font-sans); letter-spacing: -0.048em; }
.title span {
  padding-bottom: 0.08em;
  background: linear-gradient(95deg, var(--grad-from), var(--grad-to));
  background-clip: text;
  color: transparent;
}
.tagline { max-width: 540px; margin-top: 26px; color: var(--ink-muted); font: 400 25px/1.5 var(--font-sans); letter-spacing: -0.005em; }
.install {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  height: 54px;
  margin-top: 36px;
  padding: 0 22px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  font: 400 20px/1 var(--font-mono);
}
.install b { color: var(--ink-faint); font-weight: 400; }

/* The Backlog art, as on the home hero (docs/theme/index.css, .vdnd-hero-art). */
.art { position: absolute; z-index: 1; top: 50%; right: 64px; width: 500px; perspective: 1700px; transform: translateY(-50%); }
.art__stage { position: relative; padding: 0 6px 0 18px; transform: rotateX(8deg) rotateY(-16deg) rotateZ(1.2deg); transform-origin: 45% 50%; }
.art__virtuals { display: flex; flex-direction: column; gap: 8px; }
.art__virtuals--top { margin-bottom: 12px; mask-image: linear-gradient(transparent, #000 90%); }
.art__virtuals--bottom { margin-top: 12px; mask-image: linear-gradient(#000 10%, transparent); }
.art__virtual {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  margin: 0 30px;
  padding: 0 16px;
  border: 1px dashed var(--ghost);
  border-radius: 10px;
  color: var(--ink-faint);
  font: 500 13.5px/1 var(--font-sans);
}
.art__tag { color: var(--accent-text); font: 500 11px/1 var(--font-mono); }
.art__list {
  position: relative;
  padding: 14px;
  border: 1px solid var(--list-edge);
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, #0e1622, #090d14);
  box-shadow: var(--shadow-panel);
}
.art__head { display: flex; align-items: center; gap: 6px; padding: 2px 4px 12px; }
.art__name { margin-right: auto; font: 600 14.5px/1.2 var(--font-sans); letter-spacing: -0.015em; }
.art__count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--ink-muted);
  font: 500 11px/1 var(--font-mono);
  white-space: nowrap;
}
.art__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent); }
.art__rows { position: relative; height: calc(46px * 5 + 8px * 4); }
.art__row, .art__slot, .art__preview { position: absolute; top: 0; right: 0; left: 0; height: 46px; border-radius: var(--radius-md); }
.art__row, .art__slot { transform: translateY(calc(var(--i) * 54px)); }
.art__row, .art__preview { display: flex; align-items: center; gap: 10px; padding: 0 14px; font: 500 14.5px/1 var(--font-sans); letter-spacing: -0.01em; }
.art__row { border: 1px solid var(--row-line); background: var(--row-bg); }
.art__row svg, .art__preview svg { flex-shrink: 0; color: var(--ink-faint); }
.art__slot { border: 1.5px dashed var(--accent-line); background: var(--accent-tint); }
/* The held row: the row at its exact size and angle, offset only by the pointer. */
.art__preview {
  z-index: 2;
  border: 1.5px solid var(--held);
  background: #17202d;
  box-shadow: var(--shadow-lift);
  transform: translate(22px, calc(var(--i) * 54px + 10px));
}
.art__preview > svg:first-child { color: var(--held); }
.art__cursor { position: absolute; top: 24px; right: 34px; width: 22px; height: 22px; }
.art__cursor path { fill: #ffffff; stroke: #05070b; stroke-width: 1.4; stroke-linejoin: round; }
</style>
</head>
<body>
<div class="og">
  <div class="text">
    <div class="lockup">
      <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
        <rect class="mark__ghost" x="5" y="1" width="14" height="2" rx="1"/>
        <rect class="mark__row" x="5" y="8.75" width="14" height="2.5" rx="1.1"/>
        <rect class="mark__held" x="8" y="12.75" width="14" height="2.5" rx="1.1"/>
        <rect class="mark__ghost" x="5" y="21" width="14" height="2" rx="1"/>
        <rect class="mark__frame" x="2" y="5.5" width="20" height="13" rx="3"/>
      </svg>
      ngx-virtual-dnd
    </div>
    <h1 class="title">${escapeHtml(lead)}<br><span>${escapeHtml(highlight)}</span></h1>
    <p class="tagline">${escapeHtml(tagline)}</p>
    <div class="install"><b>$</b>${escapeHtml(install)}</div>
  </div>
  <div class="art" aria-hidden="true">
    <div class="art__stage">
      <div class="art__virtuals art__virtuals--top">${[39, 40].map(virtualRow).join('')}</div>
      <div class="art__list">
        <div class="art__head">
          <span class="art__name">Backlog</span>
          <span class="art__count">1,000 items</span>
          <span class="art__count"><i class="art__dot"></i>5 in the DOM</span>
        </div>
        <div class="art__rows">
          ${row(41, 0)}${row(42, 1)}${row(44, 3)}${row(45, 4)}
          <div class="art__slot" style="--i: 2"></div>
          <div class="art__preview" style="--i: 2">${grip}<span>Task 43</span>
            <svg class="art__cursor" viewBox="0 0 24 24"><path d="M4.5 2.5l14.8 9.1-6.5 1.3 3.7 6.7-2.6 1.4-3.7-6.7-5.1 4.6z"/></svg>
          </div>
        </div>
      </div>
      <div class="art__virtuals art__virtuals--bottom">${[46, 47].map(virtualRow).join('')}</div>
    </div>
  </div>
</div>
</body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: output });
  console.log(`og-image: wrote ${output}`);
} finally {
  await browser.close();
}
