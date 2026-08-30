// The shell, in a real browser, at real device sizes.
//
// This is the only test in the project that renders anything. It cannot run
// the Godot engine — nothing here compiles GDScript — but it CAN prove the
// three things the engine depends on the page to get right:
//
//   1. the canvas is exactly the size of the visible safe area, and its
//      backing store matches its CSS box, so touches land where they look;
//   2. a desktop visitor never downloads the engine at all;
//   3. a phone held sideways is asked to turn back, and the game is paused
//      while it is.
//
// Playwright is optional. Where it is missing the test skips rather than
// failing, so CI without a browser stays green.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { buildExport } from './fake-export.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(tmpdir(), 'dovefall-shell-test');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.pck': 'application/octet-stream',
};

async function loadPlaywright() {
  for (const p of [
    'playwright',
    '/opt/node22/lib/node_modules/playwright/index.js',
    '/usr/lib/node_modules/playwright/index.js',
  ]) {
    try {
      const m = await import(p);
      // Installed globally it resolves as CommonJS, so the namespace has only
      // a default. Locally it is ESM and the names are on the namespace.
      const lib = m.chromium ? m : m.default;
      if (lib && lib.chromium) return lib;
    } catch { /* try the next one */ }
  }
  return null;
}

function serve(dir) {
  const requested = [];
  const server = createServer((req, res) => {
    const name = req.url.split('?')[0].replace(/^\/+/, '') || 'index.html';
    requested.push(name);
    const file = join(dir, name);
    if (!existsSync(file)) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server, requested, url: `http://127.0.0.1:${server.address().port}/`,
    }));
  });
}

// Real reported viewports. Heights are the visible area with browser chrome
// showing, which is the worst case a player actually sees.
const PHONES = [
  { name: 'Pixel 9 Pro', width: 448, height: 936, dpr: 2.857 },
  { name: 'iPhone 16', width: 393, height: 852, dpr: 3 },
  { name: 'iPhone 16 (Safari toolbars)', width: 393, height: 745, dpr: 3 },
  { name: 'Galaxy S24', width: 360, height: 700, dpr: 3 },
  { name: 'iPhone SE', width: 375, height: 553, dpr: 2 },
];

// Running as root in a container, so the sandbox has to be off; /dev/shm is
// small here, which crashes a default Chromium mid-navigation.
const LAUNCH = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };

const pw = await loadPlaywright();

describe('the shell in a browser', { skip: pw ? false : 'playwright not installed' }, () => {
  test('every phone gets a full-bleed canvas and an identical playfield', async () => {
    const measured = [];
    buildExport(DIR);
    const { server, url } = await serve(DIR);
    const browser = await pw.chromium.launch(LAUNCH);
    try {
      for (const d of PHONES) {
        const ctx = await browser.newContext({
          viewport: { width: d.width, height: d.height },
          deviceScaleFactor: d.dpr,
          isMobile: true,
          hasTouch: true,
        });
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForFunction('window.__gameStarted === true', null, { timeout: 5000 });

        const m = await page.evaluate(() => {
          const c = document.getElementById('canvas');
          const f = document.getElementById('frame');
          return {
            cssW: parseFloat(c.style.width),
            cssH: parseFloat(c.style.height),
            bufW: c.width,
            bufH: c.height,
            frameW: f.clientWidth,
            frameH: f.clientHeight,
            dpr: window.devicePixelRatio,
            blocked: !document.getElementById('handheld-only').hidden,
            engine: window.__engineLoaded === true,
          };
        });

        assert.equal(m.blocked, false, `${d.name}: a phone must not be blocked`);
        assert.equal(m.engine, true, `${d.name}: the engine must load`);
        assert.equal(m.cssW, m.frameW, `${d.name}: canvas is as wide as the safe area`);
        assert.equal(m.cssH, m.frameH, `${d.name}: canvas is as tall as the safe area`);
        assert.equal(m.cssW, d.width, `${d.name}: full width, no side gap`);

        // The backing store matches the CSS box times the (capped) ratio, or
        // every touch lands offset from what the player sees.
        const cap = Math.min(m.dpr, 3);
        assert.equal(m.bufW, Math.round(m.cssW * cap), `${d.name}: framebuffer width`);
        assert.equal(m.bufH, Math.round(m.cssH * cap), `${d.name}: framebuffer height`);

        // And the claim the whole design rests on: same playfield everywhere.
        const scale = Math.min(m.cssW / 1080, m.cssH / 1920);
        assert.ok(scale > 0.28 && scale < 0.6, `${d.name}: scale ${scale} in range`);
        assert.equal(Math.round(1080 * scale * (1 / scale)), 1080, `${d.name}: viewport invariant`);

        measured.push(
          `    ${d.name.padEnd(28)}${`${m.cssW}x${m.cssH}`.padStart(9)} css  ` +
          `${`${m.bufW}x${m.bufH}`.padStart(11)} px  scale ${scale.toFixed(3)}  ` +
          `bars ${String(Math.round((m.cssH - 1920 * scale) / 2)).padStart(3)} px`,
        );
        await ctx.close();
      }
      console.log('\n  measured in Chromium:\n' + measured.join('\n') + '\n');
    } finally {
      await browser.close();
      server.close();
    }
  });

  test('a desktop visitor is asked to use a phone, and downloads no engine', async () => {
    buildExport(DIR);
    const { server, requested, url } = await serve(DIR);
    const browser = await pw.chromium.launch(LAUNCH);
    try {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        isMobile: false,
        hasTouch: false,
      });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });

      const m = await page.evaluate(() => ({
        blocked: !document.getElementById('handheld-only').hidden,
        engine: window.__engineLoaded === true,
        heading: document.querySelector('#handheld-only h1').textContent,
        shown: document.getElementById('ho-url').textContent,
      }));

      assert.equal(m.blocked, true, 'the desktop panel is shown');
      assert.equal(m.engine, false, 'and the engine is never constructed');
      assert.match(m.heading, /phone game/i);
      assert.match(m.shown, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'the link to copy is this page');
      assert.equal(requested.includes('index.js'), false, 'index.js was never requested');
      assert.equal(requested.includes('index.wasm'), false, 'nor the engine binary');
      await ctx.close();
    } finally {
      await browser.close();
      server.close();
    }
  });

  test('the support override lets a laptop through', async () => {
    buildExport(DIR);
    const { server, url } = await serve(DIR);
    const browser = await pw.chromium.launch(LAUNCH);
    try {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false,
      });
      const page = await ctx.newPage();
      await page.goto(`${url}?device=any`, { waitUntil: 'load' });
      await page.waitForFunction('window.__gameStarted === true', null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => document.getElementById('handheld-only').hidden), true);
      await ctx.close();
    } finally {
      await browser.close();
      server.close();
    }
  });

  test('sideways on a phone: rotate prompt up, game paused', async () => {
    buildExport(DIR);
    const { server, url } = await serve(DIR);
    const browser = await pw.chromium.launch(LAUNCH);
    try {
      const ctx = await browser.newContext({
        viewport: { width: 393, height: 745 },
        deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction('window.__gameStarted === true', null, { timeout: 5000 });
      await page.evaluate(() => {
        window.__blurred = false;
        window.addEventListener('blur', () => { window.__blurred = true; });
      });

      await page.setViewportSize({ width: 745, height: 393 });
      await page.waitForFunction('document.body.classList.contains("cramped")', null, { timeout: 5000 });

      const m = await page.evaluate(() => ({
        visible: getComputedStyle(document.getElementById('rotate')).display,
        blurred: window.__blurred,
      }));
      assert.equal(m.visible, 'flex', 'the prompt is on screen');
      assert.equal(m.blurred, true, 'and Godot was told to pause');

      await page.setViewportSize({ width: 393, height: 745 });
      await page.waitForFunction('!document.body.classList.contains("cramped")', null, { timeout: 5000 });
      await ctx.close();
    } finally {
      await browser.close();
      server.close();
    }
  });
});
