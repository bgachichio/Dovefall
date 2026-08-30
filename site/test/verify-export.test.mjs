// The preflight, against exports that are good and exports that are broken.
//
// The point of these is the false POSITIVE as much as the false negative. The
// first version of verify-export.mjs looked for the strings "SharedArrayBuffer"
// and "crossOriginIsolated" to detect threads — both of which ship in
// engine/features.js in every export Godot has ever produced. It would have
// blocked every real deploy while passing the synthetic fixture it was written
// against. Hence the two "does not trip on" tests below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { buildExport } from './fake-export.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = join(HERE, '..', 'verify-export.mjs');
const ROOT = join(tmpdir(), 'dovefall-verify-test');

function run(dir, extra = []) {
  try {
    return { code: 0, out: execFileSync('node', [VERIFY, dir, ...extra], { encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function dir(name) { return join(ROOT, name); }

test('a good export passes', () => {
  const d = buildExport(dir('good'));
  const r = run(d, ['--origin', 'https://gachichio.org/dovefallgame/']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Single-threaded export/);
  assert.match(r.out, /Ready to deploy/);
});

test('a threaded export is refused', () => {
  const d = buildExport(dir('threaded'), { threads: true });
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /THREADED export/);
});

test('the PWA service worker does not trip the thread check', () => {
  // index.service.worker.js contains ".worker." and is present in every PWA
  // export. Flagging it would block the deploy we actually want.
  const d = buildExport(dir('pwa'), { pwa: true });
  const r = run(d);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /Thread worker present/);
});

test('features.js does not trip the thread check', () => {
  // The real engine loader mentions both of these, in a single-threaded build.
  const d = buildExport(dir('features'));
  writeFileSync(join(d, 'index.js'), `
    window.Engine = function () {};
    window.Engine.getMissingFeatures = function () { return []; };
    var Features = {
      isCrossOriginIsolated: function () { return window['crossOriginIsolated'] === true; },
      isSharedArrayBufferAvailable: function () { return 'SharedArrayBuffer' in window; },
    };
  `);
  const r = run(d);
  assert.equal(r.code, 0, r.out);
});

test('the stock Godot shell is refused — mobile-only would be gone', () => {
  const d = dir('stock');
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const stock = join(ROOT, 'stock-shell.html');
  writeFileSync(stock, `<!DOCTYPE html><html><head><title>$GODOT_PROJECT_NAME</title>
    $GODOT_HEAD_INCLUDE</head><body><canvas id="canvas"></canvas>
    <script src="$GODOT_URL"></script><script>
    const GODOT_CONFIG = $GODOT_CONFIG;
    const GODOT_THREADS_ENABLED = $GODOT_THREADS_ENABLED;
    </script></body></html>`);
  buildExport(d, { shell: stock });
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /DEFAULT Godot shell/);
  assert.match(r.out, /handheld-only/);
});

test('link previews pointed at the wrong host are refused', () => {
  const d = buildExport(dir('origin'));
  const r = run(d, ['--origin', 'https://dovefall.example.com/']);
  assert.equal(r.code, 1);
  assert.match(r.out, /og tags point at/);
});

test('a missing engine is refused', () => {
  const d = buildExport(dir('nowasm'));
  rmSync(join(d, 'index.wasm'));
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /No \.wasm/);
});

test("an entry file that is not index.html is refused", async () => {
  const d = buildExport(dir('named'));
  const { renameSync } = await import('node:fs');
  renameSync(join(d, 'index.html'), join(d, 'dovefall.html'));
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /not "index\.html"/);
});
