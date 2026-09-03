// The game, played in a real browser.
//
// This is the test the Godot build could never have: a phone-sized Chromium
// opens the built bundle, taps through the tutorial, flies, dies, and every
// screen is asserted and photographed. Nothing here is mocked except the
// server, which is a small local stand-in for the Worker.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const SHOTS = process.env.DOVEFALL_SHOTS || join(HERE, '..', 'shots');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.map': 'application/json',
};

async function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright/index.js']) {
    try {
      const m = await import(p);
      const lib = m.chromium ? m : m.default;
      if (lib?.chromium) return lib;
    } catch { /* next */ }
  }
  return null;
}

// A stand-in for the Worker: the same shapes, none of the logic. What is being
// tested here is the client, and a client that only works against a live
// database is a client nobody can test.
function apiHandler(req, res, url) {
  const send = (body, status = 200) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send({});

  const streaks = {
    play: { current: 6, best: 11, alive: true },
    daily: { current: 2, best: 4, alive: true },
    outcome: 'extended',
  };
  const me = { id: 'p_test', name: 'Kifaru', tag: '4T7X', respawns: 2, streaks };
  const rows = (n) => Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    name: ['Kifaru', 'Ndege', 'Simba', 'Tausi', 'Chui', 'Kunguru', 'Mwewe', 'Korongo'][i % 8],
    tag: ['4T7X', '9QM2', 'B3KD', 'X7F1', 'M2ZQ', 'K9DT', 'T4XB', 'Q1MF'][i % 8],
    score: 480 - i * 37,
    at: 1756800000 - i * 3600,
  }));

  if (url.pathname === '/v1/auth/guest') return send({ ...me, token: 'test-token' });
  if (url.pathname === '/v1/me') return send(me);
  if (url.pathname === '/v1/names/suggest') return send({ names: ['Kifaru', 'Mwewe Tulivu', 'Korongo'] });
  if (url.pathname === '/v1/runs') return send({ accepted: true, personal_best: true, streaks });
  if (url.pathname === '/v1/board/daily') return send({ day: '2026-09-03', seed: 'D0FE', entries: rows(8) });
  if (url.pathname === '/v1/board/streaks') {
    return send({ entries: rows(6).map((r, i) => ({ ...r, score: 30 - i * 3, current: 12 - i })) });
  }
  if (url.pathname.startsWith('/v1/board/')) return send({ mode: 'normal', entries: rows(10) });
  if (url.pathname === '/v1/respawns') {
    return send({ respawns: 2, pay_code: 'K7M2 QX9F', pay_url: 'https://paystack.shop/pay/dovefall' });
  }
  if (url.pathname === '/v1/respawns/spend') return send({ respawns: 1 });
  if (url.pathname === '/v1/recovery/issue') return send({ code: '3K7M-2QX9-F4TB' });
  return send({ error: 'not_found' }, 404);
}

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/v1/')) return apiHandler(req, res, url);
    let name = url.pathname.replace(/^\/+/, '') || 'index.html';
    let file = join(DIST, name);
    if (!existsSync(file)) file = join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server, url: `http://127.0.0.1:${server.address().port}/`,
    }));
  });
}

const PHONE = { viewport: { width: 393, height: 745 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const pw = await loadPlaywright();
const LAUNCH = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };

describe('Dovefall in a browser', {
  skip: !pw ? 'playwright not installed' : !existsSync(DIST) ? 'run `npm run build` first' : false,
}, () => {
  let browser; let server; let base;
  const shot = async (page, name) => {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  };

  before(async () => {
    ({ server, url: base } = await serve());
    browser = await pw.chromium.launch(LAUNCH);
  });
  after(async () => { await browser.close(); server.close(); });

  /** Tap toward the middle of the next gap until the target score or death. */
  async function autopilot(page, target) {
    for (let i = 0; i < 1400; i++) {
      const state = await page.evaluate(() => {
        const s = window.__dovefall?.sim?.();
        if (!s || s.phase !== 'play') return null;
        const next = s.gates.find((g) => !g.passed);
        return {
          score: s.score,
          y: s.y,
          vy: s.vy,
          target: next ? next.top + next.gap * 0.5 : 1920 * 0.42,
        };
      });
      if (!state) break;
      if (state.score >= target) return state.score;
      if (state.y > state.target && state.vy > -80) {
        await page.locator('canvas').dispatchEvent('pointerdown');
      }
      await page.waitForTimeout(16);
    }
    return page.evaluate(() => window.__dovefall?.sim?.()?.score ?? 0);
  }

  async function phone(fresh = true) {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    // The bundle is built with no API base — offline is the default ship
    // state — so the test points it at the stand-in. The override is honoured
    // only on localhost, which is exactly where this runs.
    await page.goto(`${base}?api=${encodeURIComponent(base.replace(/\/$/, ''))}`, { waitUntil: 'networkidle' });
    void fresh;
    return { ctx, page, errors };
  }

  test('a first-time player is asked for a name, then taught by playing', async () => {
    const { ctx, page, errors } = await phone();
    await page.waitForSelector('text=Choose your name');
    await shot(page, '01-name');

    // The three suggestions come from the server.
    await page.waitForSelector('button:has-text("Kifaru")');
    await page.click('button:has-text("Kifaru")');

    // Straight into a run — no menu in between.
    await page.waitForSelector('text=TAP TO FLAP');
    await shot(page, '02-ready');

    const canvas = page.locator('canvas');
    await canvas.tap();
    await page.waitForFunction(() => !document.body.innerText.includes('TAP TO FLAP'));

    // Fly it. The same autopilot the engine tests use — aim for the middle of
    // the next gap — but driven through real pointer events in a real browser,
    // so this exercises input, the loop, the renderer and scoring together.
    const scored = await autopilot(page, 9);
    assert.ok(scored >= 5, `autopilot scored ${scored} through real taps`);
    await shot(page, '03-playing');

    assert.deepEqual(errors, [], 'no console errors');
    await ctx.close();
  });

  test('the dove falls, dies, and is offered one free respawn', async () => {
    const { ctx, page, errors } = await phone();
    await page.click('button:has-text("Kifaru")');
    await page.waitForSelector('text=TAP TO FLAP');
    await page.locator('canvas').tap();

    // Stop tapping and gravity does the rest.
    await page.waitForSelector('text=Fly again', { timeout: 15000 });
    await shot(page, '04-death-tutorial');
    assert.ok(await page.locator('text=Keep flying — free').isVisible(), 'the free respawn is offered');

    await page.click('button:has-text("Keep flying")');
    await page.waitForSelector('text=Fly again', { state: 'detached' });
    await shot(page, '05-respawned');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test('every menu opens, and none of them throws', async () => {
    const { ctx, page, errors } = await phone();
    await page.click('button:has-text("Kifaru")');
    await page.waitForSelector('text=TAP TO FLAP');
    await page.locator('canvas').tap();
    await page.waitForSelector('text=Fly again', { timeout: 15000 });
    await page.click('button:has-text("Back")');

    await page.waitForSelector('text=DOVEFALL');
    await shot(page, '06-title');

    await page.click('button:has-text("Leaderboard")');
    await page.waitForSelector('text=All time');
    await page.waitForTimeout(300);
    await shot(page, '07-leaderboard');
    await page.click('button:has-text("Streak")');
    await page.waitForTimeout(300);
    await shot(page, '08-leaderboard-streaks');
    await page.click('button:has-text("Back")');

    await page.click('button:has-text("Wardrobe")');
    await page.waitForSelector('text=Raven');
    await shot(page, '09-wardrobe');
    await page.click('button:has-text("Back")');

    await page.click('button:has-text("Settings")');
    await page.waitForSelector('text=Difficulty');
    await shot(page, '10-settings');

    await page.click('button:has-text("Respawns")');
    await page.waitForSelector('text=Pay with Paystack');
    await page.waitForTimeout(300);
    await shot(page, '11-respawns');
    await page.click('button:has-text("Back")');

    await page.click('button:has-text("Player name")');
    await page.waitForSelector('text=Recovery');
    await shot(page, '12-account');
    await page.click('button:has-text("Back")');

    await page.click('button:has-text("Credits")');
    await page.waitForSelector('text=Brian Gachichio Karanja');
    await shot(page, '13-credits');

    assert.deepEqual(errors, [], 'no console errors across every screen');
    await ctx.close();
  });

  test('a desktop visitor gets a link and downloads no game', async () => {
    const requested = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
    const page = await ctx.newPage();
    page.on('request', (r) => requested.push(new URL(r.url()).pathname));
    await page.goto(base, { waitUntil: 'networkidle' });

    await page.waitForSelector('text=Dovefall is a phone game');
    await shot(page, '14-desktop');
    assert.ok(!requested.some((p) => /\/assets\/index-.*\.js$/.test(p)), 'the bundle was never fetched');
    await ctx.close();
  });

  test('sideways, the phone is asked for back', async () => {
    const { ctx, page } = await phone();
    await page.setViewportSize({ width: 745, height: 393 });
    await page.waitForSelector('text=Turn your phone upright');
    await shot(page, '15-rotate');
    await ctx.close();
  });

  test('every phone gets the same playfield, at its own resolution', async () => {
    // The claim the whole design rests on: the world is 1080x1920 everywhere.
    // A bigger phone buys a bigger PICTURE, never a bigger PLAYFIELD, so the
    // leaderboard compares like with like.
    const PHONES = [
      { name: 'Pixel 9 Pro', width: 448, height: 936, dpr: 2.857 },
      { name: 'iPhone 16', width: 393, height: 852, dpr: 3 },
      { name: 'iPhone 16 · Safari bars', width: 393, height: 745, dpr: 3 },
      { name: 'Galaxy S24', width: 360, height: 700, dpr: 3 },
      { name: 'iPhone SE', width: 375, height: 553, dpr: 2 },
      { name: 'iPad mini', width: 744, height: 1000, dpr: 2 },
    ];
    const table = [];
    for (const d of PHONES) {
      const ctx = await browser.newContext({
        viewport: { width: d.width, height: d.height },
        deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true,
      });
      // Skip the first-run tutorial and fly the DAILY, which is the same seed
      // for every player by definition — so any difference in the course would
      // be a difference in the geometry, which is the thing under test.
      await ctx.addInitScript(() => {
        localStorage.setItem('dovefall.v1', JSON.stringify({
          rev: 1, installId: '11111111-1111-1111-1111-111111111111',
          bests: {}, feathers: 0, owned: ['dove'], tutorialDone: true,
          name: 'Kifaru', tag: '4T7X', token: '', respawns: 0,
        }));
      });
      const page = await ctx.newPage();
      await page.goto(`${base}?api=${encodeURIComponent(base.replace(/\/$/, ''))}`, { waitUntil: 'networkidle' });
      await page.click('button:has-text("Daily Challenge")');
      await page.waitForSelector('text=TAP TO FLAP');

      const m = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        const s = window.__dovefall.sim();
        return {
          cssW: parseFloat(c.style.width),
          cssH: parseFloat(c.style.height),
          bufW: c.width,
          bufH: c.height,
          dpr: window.devicePixelRatio,
          gates: s.gates.map((g) => Math.round(g.top)),
          gap: Math.round(s.gates[0].gap),
        };
      });

      const scale = Math.min(m.cssW / 1080, m.cssH / 1920);
      assert.equal(m.bufW, Math.round(m.cssW * Math.min(m.dpr, 3)), `${d.name}: framebuffer matches its CSS box`);
      assert.equal(m.gap, 980, `${d.name}: the opening gap is the same number`);
      table.push({ name: d.name, css: `${m.cssW}x${m.cssH}`, buf: `${m.bufW}x${m.bufH}`, scale, gates: m.gates });
      await ctx.close();
    }

    // Every device flew the identical course from the identical seed.
    const first = JSON.stringify(table[0].gates);
    for (const row of table) {
      assert.equal(JSON.stringify(row.gates), first, `${row.name} got a different course`);
    }
    console.log('\n  measured in Chromium — same playfield, different pictures:\n');
    for (const r of table) {
      console.log(`    ${r.name.padEnd(24)}${r.css.padStart(10)} css  ${r.buf.padStart(11)} px  scale ${r.scale.toFixed(3)}`);
    }
    console.log(`\n    gates from this seed, on all ${table.length}: ${first}\n`);
  });

  test('the whole game is smaller than a photograph', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const total = readdirSync(join(DIST, 'assets'))
      .filter((f) => /\.(js|css)$/.test(f))
      .reduce((n, f) => n + statSync(join(DIST, 'assets', f)).size, 0);
    assert.ok(total < 700_000, `bundle is ${(total / 1024).toFixed(0)} KB uncompressed`);
  });
});
