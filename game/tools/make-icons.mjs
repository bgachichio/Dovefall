#!/usr/bin/env node
// Generates the PWA icons and the link-preview image from the game's own
// pixel art, so the icon on a home screen is the same dove that flies.
//
// Uses the headless Chromium that is already here for the browser tests rather
// than adding an image library: one fewer dependency, and the output is
// rendered by the same engine that renders the game.
//
//   node tools/make-icons.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public');

async function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright/index.js']) {
    try {
      const m = await import(p);
      const lib = m.chromium ? m : m.default;
      if (lib?.chromium) return lib;
    } catch { /* next */ }
  }
  throw new Error('playwright not installed — icons are checked in, so this is only needed to regenerate them');
}

const src = await import('../src/engine/constants.ts');
const { DOVE_FRAMES, SKINS, CHAPTERS } = src;
const skin = SKINS[0];
const pal = { W: skin.W, G: skin.G, D: skin.D, E: skin.E, O: skin.O };

function page(w, h, draw) {
  return `<!doctype html><html><body style="margin:0">
<canvas id="c" width="${w}" height="${h}"></canvas>
<script>
const g = document.getElementById('c').getContext('2d');
g.imageSmoothingEnabled = false;
const FRAME = ${JSON.stringify(DOVE_FRAMES[1])};
const PAL = ${JSON.stringify(pal)};
function dove(cx, cy, px) {
  const w = 16 * px, h = 10 * px;
  for (let r = 0; r < FRAME.length; r++)
    for (let c = 0; c < FRAME[r].length; c++) {
      const col = PAL[FRAME[r][c]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(cx - w / 2 + c * px, cy - h / 2 + r * px, px, px);
    }
}
${draw}
</script></body></html>`;
}

const ICON = (size) => page(size, size, `
  g.fillStyle = ${JSON.stringify(CHAPTERS[0].sky)};
  g.fillRect(0, 0, ${size}, ${size});
  dove(${size / 2}, ${size / 2}, Math.max(1, Math.round(${size} / 26)));
`);

const SHARE = page(1200, 630, `
  const grad = g.createLinearGradient(0, 0, 0, 630);
  grad.addColorStop(0, ${JSON.stringify(CHAPTERS[0].sky)});
  grad.addColorStop(1, ${JSON.stringify(CHAPTERS[1].sky)});
  g.fillStyle = grad; g.fillRect(0, 0, 1200, 630);
  dove(600, 250, 14);
  g.textAlign = 'center';
  g.fillStyle = '#EEF4FF';
  g.font = 'bold 88px system-ui, sans-serif';
  g.fillText('DOVEFALL', 600, 450);
  g.font = '400 34px system-ui, sans-serif';
  g.fillStyle = 'rgba(238,244,255,0.75)';
  g.fillText('One touch. Storm, deep and sky.', 600, 505);
`);

const pw = await loadPlaywright();
const browser = await pw.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
mkdirSync(OUT, { recursive: true });

for (const [name, html, w, h] of [
  ['icon-192.png', ICON(192), 192, 192],
  ['icon-512.png', ICON(512), 512, 512],
  ['share.png', SHARE, 1200, 630],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  await p.setContent(html);
  const buf = await p.locator('#c').screenshot();
  writeFileSync(join(OUT, name), buf);
  console.log(`  ${name.padEnd(16)} ${w}x${h}  ${(buf.length / 1024).toFixed(0)} KB`);
  await ctx.close();
}
await browser.close();
