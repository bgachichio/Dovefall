// Builds a fake Godot web export from the real shell, doing exactly what
// EditorExportPlatformWeb::_fix_html does: a literal, per-line substitution of
// the $GODOT_* placeholders. That means the HTML under test is byte-for-byte
// what Godot would emit from godot/web/shell.html — only the engine behind it
// is a stub.
//
// Used by shell.test.mjs (does the page behave?) and by verify-export.test.mjs
// (does the preflight catch a bad export?).

import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHELL = join(HERE, '..', '..', 'godot', 'web', 'shell.html');

// The subset of GODOT_CONFIG the shell and the engine loader actually read.
const CONFIG = {
  canvasResizePolicy: 0,
  experimentalVK: true,
  focusCanvas: true,
  gdextensionLibs: [],
  executable: 'index',
  args: [],
  fileSizes: { 'index.pck': 4194304, 'index.wasm': 41943040 },
  ensureCrossOriginIsolationHeaders: false,
};

// A stand-in for index.js. Same two entry points the shell touches, plus a
// marker so a test can prove the file was or was not fetched.
const ENGINE_STUB = `
window.__engineLoaded = true;
window.Engine = function (config) { this.config = config; };
window.Engine.getMissingFeatures = function () { return window.__missing || []; };
window.Engine.prototype.startGame = function (opts) {
  if (opts && opts.onProgress) opts.onProgress(1, 2);
  window.__gameStarted = true;
  return Promise.resolve();
};
`;

export function buildExport(dir, opts = {}) {
  const { threads = false, pwa = true, shell = SHELL, splash = '#1F3864' } = opts;

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  let head = '<link id="-gd-engine-icon" rel="icon" type="image/png" href="index.icon.png" />\n'
    + '<link rel="apple-touch-icon" href="index.apple-touch-icon.png"/>\n';
  const config = { ...CONFIG };
  if (pwa) {
    head += '<link rel="manifest" href="index.manifest.json">\n';
    config.serviceWorker = 'index.service.worker.js';
  }

  const replaces = {
    $GODOT_URL: 'index.js',
    $GODOT_PROJECT_NAME: 'Dovefall',
    $GODOT_HEAD_INCLUDE: head,
    $GODOT_CONFIG: JSON.stringify(config),
    $GODOT_SPLASH_COLOR: splash,
    $GODOT_SPLASH_CLASSES: 'show-image--false fullsize--false use-filter--true',
    $GODOT_SPLASH: 'index.png',
    $GODOT_THREADS_ENABLED: threads ? 'true' : 'false',
  };

  // Godot replaces line by line; so do we, for the same result.
  const html = readFileSync(shell, 'utf8').split('\n').map((line) => {
    let out = line;
    for (const [k, v] of Object.entries(replaces)) out = out.split(k).join(v);
    return out;
  }).join('\n');

  writeFileSync(join(dir, 'index.html'), html);
  writeFileSync(join(dir, 'index.js'), ENGINE_STUB + (threads
    ? '\nvar _t = new SharedArrayBuffer(8); if (crossOriginIsolated) {}\nvar PThread = { pthreadPoolSize: 4 };\n'
    : '\n// single-threaded build\n'));
  writeFileSync(join(dir, 'index.wasm'), Buffer.alloc(4096, 7));
  writeFileSync(join(dir, 'index.pck'), Buffer.alloc(2048, 3));
  writeFileSync(join(dir, 'index.audio.worklet.js'), '// worklet\n');
  writeFileSync(join(dir, 'index.icon.png'), Buffer.alloc(256));
  writeFileSync(join(dir, 'index.apple-touch-icon.png'), Buffer.alloc(256));
  if (pwa) {
    writeFileSync(join(dir, 'index.service.worker.js'), '// service worker\n');
    writeFileSync(join(dir, 'index.manifest.json'), JSON.stringify({
      name: 'Dovefall', start_url: './index.html', display: 'standalone',
      orientation: 'portrait', background_color: '#1F3864', icons: [],
    }));
    writeFileSync(join(dir, 'index.offline.html'), '<!doctype html>offline');
  }
  return dir;
}
