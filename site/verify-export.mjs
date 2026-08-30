#!/usr/bin/env node
// Preflight for the Godot web export. Run it BEFORE `wrangler deploy`.
//
// Every check here corresponds to something that has actually gone wrong, or
// that a plausible-sounding plan would have got wrong. A deploy that passes
// this is a deploy worth making; one that fails would have shipped a page that
// 404s its own engine, downloads 6 MB to a laptop that cannot play it, or
// demands headers no host is sending.
//
//   node verify-export.mjs public/dovefallgame
//   node verify-export.mjs public/dovefallgame --origin https://gachichio.org/dovefallgame/

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) || 'public/dovefallgame';
const originFlag = args.indexOf('--origin');
const origin = originFlag >= 0 ? args[originFlag + 1] : null;

const fail = [];
const warn = [];
const note = [];

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

if (!existsSync(dir)) {
  console.error(`\n  No export at ${dir}\n\n  Export from Godot to that directory first:\n` +
    `    Project > Export > Web > Export Project\n`);
  process.exit(1);
}

const files = readdirSync(dir);
const find = (ext) => files.find((f) => f.endsWith(ext));
const read = (f) => readFileSync(join(dir, f), 'utf8');

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

const src = html ? read(html) : '';

// ---------------------------------------------------------------- 2. threads
//
// THE ONE THAT MATTERS. A threaded export needs COOP/COEP cross-origin
// isolation, which: forbids embedding the game in any page that carries
// third-party frames (an ad frame, itch.io, a portal), adds a header
// dependency to every host, and buys Dovefall nothing — it is a 2D game on a
// fixed 120 Hz step that spawns no threads. Single-threaded is the Godot
// default and needs no headers at all.
//
// Godot writes the answer into the page verbatim, from
// EditorExportPlatformWeb::_fix_html:
//     replaces["$GODOT_THREADS_ENABLED"] = "true" | "false"
//
// Do NOT test for the strings "SharedArrayBuffer" or "crossOriginIsolated":
// engine/features.js ships in every export, threaded or not, and mentions
// both. Testing for them fails every good export, which is worse than not
// testing at all.
const threadDecl = /GODOT_THREADS_ENABLED\s*=\s*(true|false)/.exec(src);
if (threadDecl && threadDecl[1] === 'true') {
  fail.push('THREADED export: the page declares GODOT_THREADS_ENABLED = true.\n' +
    '    Re-export with variant/thread_support = false. Threads require COOP/COEP\n' +
    '    isolation, which blocks embedding, and this game spawns no threads.');
} else if (threadDecl) {
  note.push('Single-threaded export — no COOP/COEP headers needed anywhere.');
} else {
  // The template changed, or this is not a Godot page. Fall back to the
  // emscripten pthread glue, which only exists in a threaded build.
  const glue = js.filter((f) => /\bPThread\b|pthreadPoolSize/.test(read(f)));
  if (glue.length) {
    fail.push(`Threaded export: ${glue[0]} contains the emscripten pthread runtime.`);
  } else {
    warn.push('Could not find GODOT_THREADS_ENABLED. Confirm Threads is off in the preset by hand.');
  }
}

// The PWA service worker injects COOP/COEP when this is on, which is the same
// isolation problem arriving by a different route.
if (/"ensureCrossOriginIsolationHeaders"\s*:\s*true/.test(src)) {
  fail.push('progressive_web_app/ensure_cross_origin_isolation_headers is ON.\n' +
    '    The service worker will inject COOP/COEP and re-isolate the page. Turn it off.');
}

// ---------------------------------------------------------------- 3. the shell
//
// The custom shell is where mobile-only, the safe-area canvas and the
// portrait prompt live. A plain re-export silently drops all three: the page
// still works on a desktop, which is exactly the failure that goes unnoticed.
if (html) {
  if (!/dovefallDeviceClass/.test(src)) {
    fail.push('Exported with the DEFAULT Godot shell — the mobile-only check is missing.\n' +
      '    Set html/custom_html_shell to res://web/shell.html and re-export.');
  }
  if (!/id="handheld-only"/.test(src)) {
    fail.push('No handheld-only panel in the page. Desktop visitors would download the engine.');
  }
  if (!/"canvasResizePolicy"\s*:\s*0/.test(src)) {
    fail.push('canvas_resize_policy is not None. The shell sizes the canvas itself;\n' +
      '    leaving Godot to do it reintroduces the iOS Safari toolbar bug.');
  }
  if (!/"experimentalVK"\s*:\s*true/.test(src)) {
    warn.push('experimental_virtual_keyboard is off — players cannot type a name on a phone.');
  }
}

// ---------------------------------------------------------------- 4. paths
//
// Godot references its siblings relatively, so the bundle works under any
// subpath — but only if the request carries a trailing slash. An absolute
// "/index.wasm" would break the moment it is served from /dovefallgame/.
if (html) {
  const absolute = [...src.matchAll(/(?:src|href)="(\/[^/][^"]*)"/g)].map((m) => m[1]);
  if (absolute.length) {
    fail.push(`index.html references absolute paths (${absolute.slice(0, 3).join(', ')}). ` +
      'They will 404 under /dovefallgame/.');
  }
}

// ---------------------------------------------------------------- 5. sharing
//
// Link previews are set at export time because crawlers do not run JavaScript.
// A wrong origin here means every share on WhatsApp is a bare grey box.
if (html) {
  const og = (prop) => {
    const m = new RegExp(`property="${prop}" content="([^"]*)"`).exec(src)
      || new RegExp(`content="([^"]*)" property="${prop}"`).exec(src);
    return m ? m[1] : null;
  };
  const ogUrl = og('og:url');
  const ogImage = og('og:image');
  if (!ogUrl || !ogImage) {
    warn.push('No og:url / og:image — shared links will preview as a blank card.');
  } else if (!/^https:\/\//.test(ogImage)) {
    fail.push(`og:image is "${ogImage}". Crawlers need an absolute https URL.`);
  } else if (origin) {
    const base = origin.endsWith('/') ? origin : `${origin}/`;
    if (!ogUrl.startsWith(base) || !ogImage.startsWith(base)) {
      fail.push(`og tags point at ${ogUrl}, but this deploy is ${base}.\n` +
        '    Fix the og:url and og:image in godot/web/shell.html and re-export.');
    } else {
      note.push(`Link previews point at ${base}`);
    }
  } else {
    note.push(`Link previews point at ${ogUrl} — pass --origin to check that against the deploy.`);
  }
  const imageFile = ogImage ? ogImage.split('/').pop() : null;
  if (imageFile && !files.includes(imageFile)) {
    warn.push(`og:image names ${imageFile}, which is not in the export.`);
  }
}

// ---------------------------------------------------------------- 6. the PWA
//
// Installed to the home screen the game gets the whole screen — on an iPhone
// 16 that is 107 more CSS px of sky — and a portrait lock the browser cannot
// give it. Worth having, not worth blocking a deploy over.
const manifest = files.find((f) => f.endsWith('.manifest.json'));
if (!manifest) {
  warn.push('No PWA manifest. Enable progressive_web_app for add-to-home-screen and a portrait lock.');
} else {
  try {
    const m = JSON.parse(read(manifest));
    if (m.orientation !== 'portrait') warn.push(`Manifest orientation is "${m.orientation}", not portrait.`);
    if (m.display !== 'standalone' && m.display !== 'fullscreen') {
      warn.push(`Manifest display is "${m.display}" — installed, it will still show browser chrome.`);
    }
    if (!m.icons || !m.icons.length) warn.push('Manifest has no icons.');
    note.push(`PWA: ${m.display}, ${m.orientation}, ${(m.icons || []).length} icons.`);
  } catch {
    fail.push(`${manifest} is not valid JSON.`);
  }
}

// A .worker.js that is NOT the service worker or an audio worklet means threads.
const strayWorker = files.filter((f) => /\.worker\./.test(f) && !/service\.worker|worklet/.test(f));
if (strayWorker.length) fail.push(`Thread worker present: ${strayWorker.join(', ')}`);

// ---------------------------------------------------------------- 7. bloat
const storeArt = files.filter((f) => /screenshot|feature-\d|icon-512/.test(f));
if (storeArt.length) {
  warn.push(`Play Store artwork is in the bundle (${storeArt.join(', ')}). ` +
    'Set exclude_filter to store/* — no player ever sees it.');
}

// ---------------------------------------------------------------- 8. weight
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
