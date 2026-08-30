#!/usr/bin/env node
// Preflight for the Godot web export. Run it BEFORE `wrangler deploy`.
//
// Every check here corresponds to something that has actually gone wrong, or
// that a plausible-sounding plan would have got wrong. A deploy that passes
// this is a deploy worth making; one that fails would have shipped a game that
// 404s its own engine, or one that cannot be embedded anywhere.
//
//   node verify-export.mjs public/dovefallgame

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const dir = process.argv[2] || 'public/dovefallgame';
const fail = [];
const warn = [];
const note = [];

function kb(n) { return `${(n / 1024).toFixed(0)} KB`; }
function mb(n) { return `${(n / 1024 / 1024).toFixed(2)} MB`; }

if (!existsSync(dir)) {
  console.error(`\n  No export at ${dir}\n\n  Export from Godot to that directory first:\n` +
    `    Project > Export > Web > Export Project\n`);
  process.exit(1);
}

const files = readdirSync(dir);
const find = (ext) => files.find((f) => f.endsWith(ext));

// ---------------------------------------------------------------- 1. shape
const html = find('.html');
const wasm = find('.wasm');
const pck = find('.pck');
const js = files.filter((f) => f.endsWith('.js'));

if (!html) fail.push('No .html — this is not a Godot web export.');
if (!wasm) fail.push('No .wasm — the engine is missing; the page would load and do nothing.');
if (!pck) fail.push('No .pck — the game data is missing.');
if (!js.length) fail.push('No .js loader.');

// Godot names the entry file after the export preset. Anything but index.html
// means the URL needs the filename in it, which breaks a clean /dovefallgame/.
if (html && html !== 'index.html') {
  fail.push(`Entry file is "${html}", not "index.html". Set the export path to ` +
    `index.html or the folder URL will 404.`);
}

// ---------------------------------------------------------------- 2. threads
//
// THE ONE THAT MATTERS. A threaded export needs COOP/COEP cross-origin
// isolation, which: forbids embedding the game in any page that carries
// third-party frames (H5 Games Ads, itch.io, a portal), adds a header
// dependency to every host, and buys Dovefall nothing — it is a 2D game on a
// fixed 120 Hz step that spawns no threads. Single-threaded is the Godot 4.3+
// default and needs no headers at all.
const threadMarkers = [];
for (const f of [...js, html].filter(Boolean)) {
  const src = readFileSync(join(dir, f), 'utf8');
  if (/SharedArrayBuffer/.test(src)) threadMarkers.push(`${f} references SharedArrayBuffer`);
  if (/crossOriginIsolated/.test(src)) threadMarkers.push(`${f} checks crossOriginIsolated`);
}
if (files.some((f) => f.includes('.worker.'))) threadMarkers.push('a .worker.js file is present');

if (threadMarkers.length) {
  fail.push(
    'This looks like a THREADED export:\n      - ' + threadMarkers.join('\n      - ') +
    '\n    Re-export with threads OFF. Threads require COOP/COEP isolation, which ' +
    'blocks\n    embedding and ad frames, and this game spawns no threads.',
  );
} else {
  note.push('Single-threaded export — no COOP/COEP headers needed anywhere.');
}

// ---------------------------------------------------------------- 3. paths
//
// Godot references its siblings relatively, so the bundle works under any
// subpath — but only if the request carries a trailing slash. An absolute
// "/index.wasm" would break the moment it is served from /dovefallgame/.
if (html) {
  const src = readFileSync(join(dir, html), 'utf8');
  const absolute = [...src.matchAll(/(?:src|href)="(\/[^/][^"]*)"/g)].map((m) => m[1]);
  if (absolute.length) {
    fail.push(`index.html references absolute paths (${absolute.slice(0, 3).join(', ')}). ` +
      'They will 404 under /dovefallgame/.');
  }
}

// ---------------------------------------------------------------- 4. bloat
const storeArt = files.filter((f) => /screenshot|feature-\d|icon-512/.test(f));
if (storeArt.length) {
  warn.push(`Play Store artwork is in the bundle (${storeArt.join(', ')}). ` +
    'Set exclude_filter to store/* — no player ever sees it.');
}

// ---------------------------------------------------------------- 5. weight
let raw = 0;
const rows = [];
for (const f of files) {
  const size = statSync(join(dir, f)).size;
  raw += size;
  rows.push([f, size]);
}
rows.sort((a, b) => b[1] - a[1]);

// What the player actually downloads: Cloudflare serves Brotli, so compress the
// compressible files and take the rest as-is.
let wire = 0;
for (const [f, size] of rows) {
  const compressible = /\.(wasm|js|html|json|css|svg)$/.test(f);
  if (!compressible) { wire += size; continue; }
  wire += brotliCompressSync(readFileSync(join(dir, f)), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
}

// ---------------------------------------------------------------- report
console.log(`\n  Dovefall export preflight — ${dir}\n`);
for (const [f, size] of rows.slice(0, 6)) {
  console.log(`    ${f.padEnd(28)} ${kb(size).padStart(9)}`);
}
if (rows.length > 6) console.log(`    ${`… ${rows.length - 6} more`.padEnd(28)}`);

console.log(`\n    uncompressed  ${mb(raw)}`);
console.log(`    over the wire ${mb(wire)}   <- write this number down\n`);

// The cost model assumed ~6 MB per cold load. Anything far above that is worth
// knowing before it is multiplied by every player who ever visits.
if (wire > 8 * 1024 * 1024) {
  warn.push(`Wire size ${mb(wire)} is well above the ~6 MB the cost model assumed. ` +
    'Bandwidth is unmetered so it costs nothing, but first-load time is a real ' +
    'conversion cost on a Kenyan mobile connection.');
}

for (const n of note) console.log(`  ok    ${n}`);
for (const w of warn) console.log(`  warn  ${w}`);
for (const f of fail) console.log(`  FAIL  ${f}`);

if (fail.length) {
  console.log(`\n  ${fail.length} blocking problem(s). Do not deploy.\n`);
  process.exit(1);
}
console.log(`\n  Ready to deploy:  npx wrangler deploy\n`);
