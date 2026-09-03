#!/usr/bin/env node
// Preflight for the game bundle. Run it BEFORE `wrangler deploy`.
//
// Every check corresponds to something that has actually gone wrong here, or
// that a plausible-sounding change would break silently. A deploy that passes
// this is a deploy worth making.
//
//   node verify-build.mjs public/dovefallgame
//   node verify-build.mjs public/dovefallgame --origin https://gachichio.org/dovefallgame/

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) || 'public/dovefallgame';
const oi = args.indexOf('--origin');
const origin = oi >= 0 ? args[oi + 1] : null;

const fail = [];
const warn = [];
const note = [];
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

if (!existsSync(dir)) {
  console.error(`\n  Nothing at ${dir}\n\n  Build the game and sync it first:\n` +
    `    cd ../game && npm run build\n    cd ../site && npm run sync\n`);
  process.exit(1);
}

function walk(d, prefix = '') {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(join(d, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]
  ));
}
const files = walk(dir);
const read = (f) => readFileSync(join(dir, f), 'utf8');
const has = (f) => files.includes(f);

// ---------------------------------------------------------------- 1. shape
if (!has('index.html')) fail.push('No index.html — this is not a built bundle.');
const js = files.filter((f) => f.endsWith('.js') && !f.endsWith('.map'));
if (!js.length) fail.push('No JavaScript — the build produced nothing to run.');
const src = has('index.html') ? read('index.html') : '';

// ------------------------------------------------------------- 2. the entry
//
// The bundle used to be held back behind a device check; Dovefall now plays on
// anything with a pointer, so the entry is an ordinary module script again and
// the only thing worth asserting is that it exists and resolves. A build that
// emits index.html with no entry loads a blank page and reports no error.
if (src) {
  const tags = [...src.matchAll(/<script[^>]+type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  if (!tags.length) {
    fail.push('index.html loads no module script — the page would render nothing.');
  }
  for (const t of tags) {
    const rel = t.replace(/^\.?\//, '');
    if (!has(rel)) fail.push(`index.html loads ${t}, which is not in the bundle.`);
  }
  if (tags.length) note.push(`Entry: ${tags.join(', ')}`);

  // The rotate prompt is the one remaining interception, and it is phone-only.
  if (!/id="rotate"/.test(src)) {
    warn.push('No portrait prompt — a phone held sideways gets an unplayable strip.');
  }
  if (/dovefall is a phone game/i.test(src)) {
    fail.push('The old mobile-only gate is still in index.html. It blocks every\n' +
      '    desktop visitor, and the game now supports them.');
  }
}

// ---------------------------------------------------------------- 3. paths
// Vite is configured with base "./" so the bundle works under /dovefallgame/.
// An absolute "/assets/…" would 404 the moment it is served from a subpath.
if (src) {
  const abs = [...src.matchAll(/(?:src|href)="(\/[^/][^"]*)"/g)].map((m) => m[1]);
  if (abs.length) {
    fail.push(`index.html references absolute paths (${abs.slice(0, 3).join(', ')}). ` +
      'They will 404 under /dovefallgame/. Check `base` in vite.config.ts.');
  }
}

// ---------------------------------------------------------------- 4. the PWA
if (!has('manifest.webmanifest')) {
  warn.push('No manifest — no Add to Home Screen, and no portrait lock.');
} else {
  try {
    const m = JSON.parse(read('manifest.webmanifest'));
    if (m.orientation !== 'portrait') warn.push(`Manifest orientation is "${m.orientation}", not portrait.`);
    if (m.display !== 'standalone' && m.display !== 'fullscreen') {
      warn.push(`Manifest display is "${m.display}" — installed, it still shows browser chrome.`);
    }
    for (const i of m.icons ?? []) {
      if (!has(i.src.replace(/^\.?\//, ''))) fail.push(`Manifest names ${i.src}, which is missing.`);
    }
    note.push(`PWA: ${m.display}, ${m.orientation}, ${(m.icons ?? []).length} icons.`);
  } catch { fail.push('manifest.webmanifest is not valid JSON.'); }
}
if (!has('sw.js')) warn.push('No service worker — the game will not open offline.');

// ---------------------------------------------------------------- 5. sharing
// Crawlers do not run JavaScript, so the previews are fixed at build time. A
// wrong origin here means every share on WhatsApp is a blank grey card.
if (src) {
  const og = (p) => (new RegExp(`property="${p}" content="([^"]*)"`).exec(src) ?? [])[1];
  const url = og('og:url');
  const image = og('og:image');
  if (!url || !image) warn.push('No og:url / og:image — shared links preview as a blank card.');
  else if (!/^https:\/\//.test(image)) fail.push(`og:image is "${image}". Crawlers need an absolute https URL.`);
  else if (origin) {
    const base = origin.endsWith('/') ? origin : `${origin}/`;
    if (!url.startsWith(base) || !image.startsWith(base)) {
      fail.push(`og tags point at ${url}, but this deploy is ${base}.\n` +
        '    Fix them in game/index.html and rebuild.');
    } else note.push(`Link previews point at ${base}`);
  } else note.push(`Link previews point at ${url} — pass --origin to check that against the deploy.`);

  if (image && !has(image.split('/').pop())) {
    warn.push(`og:image names ${image.split('/').pop()}, which is not in the bundle.`);
  }
}

// ---------------------------------------------------------------- 6. weight
let raw = 0;
const rows = [];
for (const f of files) {
  const size = statSync(join(dir, f)).size;
  if (f.endsWith('.map')) continue;          // never fetched by a player
  raw += size;
  rows.push([f, size]);
}
rows.sort((a, b) => b[1] - a[1]);

let wire = 0;
for (const [f, size] of rows) {
  if (!/\.(js|html|json|css|svg|webmanifest)$/.test(f)) { wire += size; continue; }
  wire += brotliCompressSync(readFileSync(join(dir, f)), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
}

// The whole point of leaving the engine behind. If this creeps past a
// megabyte, something large has been added without anyone noticing.
if (wire > 1024 * 1024) {
  warn.push(`Wire size ${mb(wire)} is over a megabyte. The Godot build this replaced ` +
    'was six; do not drift back.');
}

// ---------------------------------------------------------------- report
console.log(`\n  Dovefall build preflight — ${dir}\n`);
for (const [f, size] of rows.slice(0, 6)) console.log(`    ${f.padEnd(34)} ${kb(size).padStart(9)}`);
if (rows.length > 6) console.log(`    ${`… ${rows.length - 6} more`.padEnd(34)}`);
console.log(`\n    uncompressed  ${mb(raw)}`);
console.log(`    over the wire ${mb(wire)}   <- what a player downloads, once\n`);

for (const n of note) console.log(`  ok    ${n}`);
for (const w of warn) console.log(`  warn  ${w}`);
for (const f of fail) console.log(`  FAIL  ${f}`);

if (fail.length) {
  console.log(`\n  ${fail.length} blocking problem(s). Do not deploy.\n`);
  process.exit(1);
}
console.log(`\n  Ready to deploy:  npx wrangler deploy\n`);
