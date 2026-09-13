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

/**
 * Playwright is a devDependency, so `npm install` brings the library. The
 * BROWSERS are a separate ~180 MB download and are not — so check for the
 * executable too, and say which of the two is missing. An earlier version
 * checked only the library and then died inside a before-hook with a raw
 * "Executable doesn't exist", which reads like a broken test rather than a
 * missing step.
 */
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

function browserReason(lib) {
  if (!lib) return 'playwright is missing — run `npm install`';
  try {
    if (!existsSync(lib.chromium.executablePath())) {
      return 'browsers not downloaded — run `npx playwright install chromium` from game/';
    }
  } catch {
    return 'browsers not downloaded — run `npx playwright install chromium` from game/';
  }
  return false;
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

  // This stand-in speaks the WORKER's dialect, not the client's convenience.
  //
  // It used to speak the client's — flat player fields, `names`, `respawns`,
  // `pay_url` — which meant the browser test passed with a client that could
  // not talk to the real server at all. A stub written to match the code it is
  // testing proves only that the code agrees with itself. Every shape below is
  // the one pinned by worker/test/contract.test.mjs.
  const streaks = {
    play: { current: 6, best: 11, alive: true, outcome: 'extended', milestone: null },
    daily: { current: 2, best: 4, alive: true, outcome: null, milestone: null },
  };
  const player = { id: 'p_test', name: 'Kifaru', tag: '4T7X', respawns: 2, guest: true };
  const rows = (n) => Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    name: ['Kifaru', 'Ndege', 'Simba', 'Tausi', 'Chui', 'Kunguru', 'Mwewe', 'Korongo'][i % 8],
    tag: ['4T7X', '9QM2', 'B3KD', 'X7F1', 'M2ZQ', 'K9DT', 'T4XB', 'Q1MF'][i % 8],
    score: 480 - i * 37,
    at: 1756800000 - i * 3600,
  }));

  if (url.pathname === '/v1/auth/guest') return send({ token: 'test-token', player });
  if (url.pathname === '/v1/me') return send({ player, bests: {}, streaks });
  if (url.pathname === '/v1/me/name') return send({ player });
  if (url.pathname === '/v1/names/suggest') {
    return send({ suggestions: ['Kifaru', 'Mwewe Tulivu', 'Korongo'] });
  }
  if (url.pathname === '/v1/runs') return send({ accepted: true, personal_best: true, streaks });
  if (url.pathname === '/v1/board/daily') return send({ day: '2026-09-03', seed: 'D0FE', entries: rows(8) });
  if (url.pathname === '/v1/board/streaks') {
    return send({ entries: rows(6).map((r, i) => ({ ...r, score: 30 - i * 3, current: 12 - i })) });
  }
  if (url.pathname.startsWith('/v1/board/')) return send({ mode: 'normal', entries: rows(10) });
  if (url.pathname === '/v1/respawns') {
    return send({
      balance: 2,
      pay_code: 'K7M2QX9F',
      pay_link: 'https://paystack.shop/pay/dovefall',
      per_payment: 3,
      min_kes: 50,
    });
  }
  if (url.pathname === '/v1/respawns/spend') return send({ ok: true, balance: 1 });
  if (url.pathname === '/v1/devices' && req.method === 'DELETE') {
    return send({ removed: true, count: 1, token: 'test-token-2' });
  }
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
  skip: browserReason(pw) || (!existsSync(DIST) ? 'run `npm run build` first' : false),
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
    await page.waitForSelector('text=What shall we call you?');
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
    assert.ok(await page.locator('text=Keep flying').isVisible(), 'the free respawn is offered');

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
    await page.waitForSelector('text=How hard');
    await shot(page, '10-settings');

    await page.click('button:has-text("Respawns")');
    await page.waitForSelector('text=Pay with Paystack');
    await page.waitForTimeout(300);
    await shot(page, '11-respawns');
    await page.click('button:has-text("Back")');

    await page.click('button:has-text("Your name")');
    await page.waitForSelector('text=Recovery');
    await shot(page, '12-account');
    await page.click('button:has-text("Back")');

    await page.click('button:has-text("Credits")');
    await page.waitForSelector('text=Brian Gachichio Karanja');
    await shot(page, '13-credits');

    assert.deepEqual(errors, [], 'no console errors across every screen');
    await ctx.close();
  });

  test('a redirect back from Paystack lands on Respawns, already credited', async () => {
    // The whole point of the same-tab payment flow: Paystack's own
    // "Redirect after payment" setting brings the browser straight back to
    // this URL with ?paid=1 on it (App.tsx's consumePaidMarker). No title
    // screen, no menu-hopping — this load IS the return trip.
    const ctx = await browser.newContext(PHONE);
    await ctx.addInitScript(() => {
      localStorage.setItem('dovefall.v1', JSON.stringify({
        rev: 1, installId: '33333333-3333-3333-3333-333333333333',
        bests: {}, feathers: 0, owned: ['dove'], tutorialDone: true,
        name: 'Kifaru', tag: '4T7X', token: '', respawns: 0,
      }));
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(
      `${base}?api=${encodeURIComponent(base.replace(/\/$/, ''))}&paid=1`,
      { waitUntil: 'networkidle' },
    );

    // Landed on Respawns directly — never saw DOVEFALL or a menu tap.
    await page.waitForSelector('text=Respawns');
    // The stub reports balance 2 against a local baseline of 0 saved above:
    // the credited banner, not a bare number update.
    await page.waitForSelector('text=+2 credited', { timeout: 10_000 });

    // The marker does not survive the load it triggered — reloading this
    // exact tab must not replay the "just paid" behaviour a second time.
    const search = await page.evaluate(() => location.search);
    assert.ok(!search.includes('paid=1'), `?paid=1 was not stripped: ${search}`);

    assert.deepEqual(errors, [], 'no console errors on the paid-redirect boot');
    await ctx.close();
  });

  test('a "you" row off the leaderboard never shows the wrong board\'s number', async () => {
    // A page-local mock, not the shared one: App boots offline-token and
    // signs in as a guest, and the shared stand-in always hands that guest
    // back as "Kifaru" — who then sits IN its board rows, which would hide
    // the exact case this test exists for. Routing just this page's /v1/*
    // calls fixes the identity AND the rows it must be absent from, without
    // touching what every other test in this file relies on.
    const ctx = await browser.newContext(PHONE);
    await ctx.route('**/v1/**', (route) => {
      const url = new URL(route.request().url());
      const send = (body) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(body),
      });
      const me = { id: 'p_absent', name: 'Zzz Test Player', tag: '0000', respawns: 0, guest: true };
      const others = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
        rank: i + 1,
        name: ['Kifaru', 'Ndege', 'Simba', 'Tausi'][i % 4],
        tag: ['4T7X', '9QM2', 'B3KD', 'X7F1'][i % 4],
        score: 480 - i * 37,
        at: 1756800000 - i * 3600,
        ...extra,
      }));
      if (url.pathname === '/v1/auth/guest' || url.pathname === '/v1/me') {
        return send({ token: 'test-token', player: me });
      }
      if (url.pathname.startsWith('/v1/board/daily')) {
        return send({ day: '2026-09-03', seed: 'D0FE', entries: others(6) });
      }
      if (url.pathname.startsWith('/v1/board/streaks')) {
        return send({ entries: others(6).map((r, i) => ({ ...r, score: 20 - i, current: 8 - i })) });
      }
      if (url.pathname.startsWith('/v1/board/')) return send({ mode: 'normal', entries: others(10) });
      return send({});
    });
    await ctx.addInitScript(() => {
      localStorage.setItem('dovefall.v1', JSON.stringify({
        rev: 1, installId: '77777777-7777-7777-7777-777777777777',
        bests: { normal: 123 }, feathers: 0, owned: ['dove'], tutorialDone: true,
        name: '', tag: '', token: '', respawns: 0,
      }));
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}?api=${encodeURIComponent(base.replace(/\/$/, ''))}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=DOVEFALL');
    // Let the boot sign-in land — App's own effect saves name/tag from it —
    // before reading s.name/s.tag by opening the Leaderboard.
    await page.waitForFunction(() => {
      try { return JSON.parse(localStorage.getItem('dovefall.v1')).name === 'Zzz Test Player'; }
      catch { return false; }
    });
    await page.click('button:has-text("Leaderboard")');

    // All time: bestFor('normal') IS exactly what this board ranks by, so a
    // player missing from the visible rows still gets an honest "you" row.
    await page.waitForSelector('text=All time');
    await page.waitForSelector('text=Zzz Test Player', { timeout: 5000 });
    assert.ok(
      await page.locator('text=00123').count() > 0,
      'the all-time "you" row does not show the local best it actually ranks by',
    );

    // Today's Sky (daily): this save has no local number for "today", so
    // there must be no fabricated "you" row putting an all-time score under
    // today's board.
    await page.click('button:has-text("Today\'s Sky")');
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator('text=Zzz Test Player').count(), 0,
      'the daily board invented a "you" row from an unrelated local number',
    );

    // Streaks: same bug, worse shape — an all-time flight score rendered in
    // the best/current streak column, indistinguishable from a real streak.
    await page.click('button:has-text("Streak")');
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator('text=Zzz Test Player').count(), 0,
      'the streaks board invented a "you" row from an unrelated local number',
    );
    assert.equal(
      await page.locator('text=00123').count(), 0,
      'the all-time score leaked into the streaks board in any form',
    );

    assert.deepEqual(errors, [], 'no console errors across every board tab');
    await ctx.close();
  });

  test('a credit noticed while dead on zero hearts resumes the flight itself', async () => {
    // Paying does not have to mean leaving this tab: the pay code works with
    // any payment that mentions it, not only the in-app "Pay with Paystack"
    // button, so a credit can land while the run is still sitting right here
    // in memory. When that happens, the point of paying was to keep flying —
    // tapping "I've paid" should not also require a trip back to the death
    // panel and a second tap on "Keep flying".
    const ctx = await browser.newContext(PHONE);
    let respawnCalls = 0;
    let spendCalled = false;
    await ctx.route('**/v1/**', (route) => {
      const url = new URL(route.request().url());
      const send = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/v1/respawns') {
        respawnCalls += 1;
        // First fetch (on mount): still zero. Second (the "I've paid" tap):
        // credited — a payment landed between the two without this tab ever
        // navigating away.
        const balance = respawnCalls === 1 ? 0 : 3;
        return send({ balance, pay_code: 'K7M2QX9F', pay_link: null, per_payment: 3, min_kes: 50 });
      }
      if (url.pathname === '/v1/respawns/spend') {
        spendCalled = true;
        return send({ ok: true, balance: 2 });
      }
      return send({});
    });
    await ctx.addInitScript(() => {
      localStorage.setItem('dovefall.v1', JSON.stringify({
        rev: 1, installId: '44444444-1111-1111-1111-111111111111',
        bests: {}, feathers: 0, owned: ['dove'], tutorialDone: true,
        name: 'Tester', tag: '0001', token: '', respawns: 0,
        settings: { sfx: false, haptics: false, atmos: 2, flashing: false, lefthand: false,
          mode: 'normal', skin: 'dove', lang: 'en', theme: 'dark', fontScale: 1 },
      }));
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}?api=${encodeURIComponent(base.replace(/\/$/, ''))}`, { waitUntil: 'networkidle' });
    await page.click('button:has-text("Fly")');
    await page.waitForSelector('text=TAP TO FLAP');
    await page.locator('canvas').dispatchEvent('pointerdown'); // start, then fall and die untapped
    await page.waitForSelector('text=Keep this round going', { timeout: 15000 });

    await page.click('button:has-text("Keep this round going")');
    await page.waitForSelector('text=Respawns');
    await page.waitForSelector('text=K7M2QX9F');

    await page.click('button:has-text("I\'ve paid")');

    // Back on the playfield, not the Respawns screen, with no tap of its own.
    await page.waitForSelector('canvas', { state: 'visible' });
    await page.waitForSelector('text=Respawns', { state: 'detached', timeout: 5000 });
    assert.ok(spendCalled, 'the credited heart was never actually spent to resume');

    const phase = await page.evaluate(() => window.__dovefall?.sim?.()?.phase);
    assert.notEqual(phase, 'dead', 'the run is still sitting dead, not resumed');

    assert.deepEqual(errors, [], 'no console errors resuming from a credited pay code');
    await ctx.close();
  });

  test('a credit after the real "Pay with Paystack" reload still resumes, exactly where it died', async () => {
    // "Pay with Paystack" is location.href — a real navigation away and,
    // via Paystack's own redirect, a real navigation back. The in-memory
    // sim does not survive that; deadrun.ts's snapshot is what has to.
    // This drives an actual reload (page.goto again, not a mocked one) and
    // checks the run that comes back is the SAME course position, not score
    // zero — and that the death it already recorded is not recorded twice.
    const ctx = await browser.newContext(PHONE);
    let runSubmissions = 0;
    let respawnCalls = 0;
    await ctx.route('**/v1/**', (route) => {
      const url = new URL(route.request().url());
      const send = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/v1/runs') { runSubmissions += 1; return send({ accepted: true, personal_best: false }); }
      if (url.pathname === '/v1/respawns') {
        respawnCalls += 1;
        // Credited on the first check this reload makes — mirrors a webhook
        // that had already landed by the time the redirect fires.
        return send({ balance: 3, pay_code: 'K7M2QX9F', pay_link: null, per_payment: 3, min_kes: 50 });
      }
      if (url.pathname === '/v1/respawns/spend') return send({ ok: true, balance: 2 });
      return send({});
    });
    const apiParam = `api=${encodeURIComponent(base.replace(/\/$/, ''))}`;
    await ctx.addInitScript(() => {
      localStorage.setItem('dovefall.v1', JSON.stringify({
        rev: 1, installId: '55555555-2222-2222-2222-222222222222',
        bests: {}, feathers: 0, owned: ['dove'], tutorialDone: true,
        name: 'Tester', tag: '0002', token: '', respawns: 0,
        settings: { sfx: false, haptics: false, atmos: 2, flashing: false, lefthand: false,
          mode: 'normal', skin: 'dove', lang: 'en', theme: 'dark', fontScale: 1 },
      }));
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${base}?${apiParam}`, { waitUntil: 'networkidle' });
    await page.click('button:has-text("Fly")');
    await page.waitForSelector('text=TAP TO FLAP');
    await page.locator('canvas').dispatchEvent('pointerdown'); // start, then fall and die untapped
    await page.waitForSelector('text=Keep this round going', { timeout: 15000 });
    const scoreAtDeath = await page.evaluate(() => window.__dovefall.sim().score);
    assert.ok(runSubmissions === 1, `the death should submit once before any reload, got ${runSubmissions}`);

    await page.click('button:has-text("Keep this round going")');
    await page.waitForSelector('text=K7M2QX9F');

    // The redirect: an actual navigation to a fresh load of this same origin,
    // carrying ?paid=1 — not a mock, the real path a browser takes.
    await page.goto(`${base}?${apiParam}&paid=1`, { waitUntil: 'networkidle' });

    // Landed back in flight, not stuck on Respawns, and at the SAME score
    // the death panel showed — the whole point of "right back where you fell".
    await page.waitForSelector('text=Respawns', { state: 'detached', timeout: 10_000 });
    await page.waitForSelector('canvas', { state: 'visible' });
    const restored = await page.evaluate(() => {
      const s = window.__dovefall?.sim?.();
      return s ? { phase: s.phase, score: s.score } : null;
    });
    assert.equal(restored?.score, scoreAtDeath, 'the resumed run did not continue from the score it died at');
    assert.equal(restored?.phase, 'play', 'the run did not actually resume into play');
    assert.ok(respawnCalls >= 1, 'the reload never checked for a credit at all');
    assert.equal(runSubmissions, 1, 'the restored death was submitted again — the same run counted twice');

    assert.deepEqual(errors, [], 'no console errors across the redirect and resume');
    await ctx.close();
  });

  test('a desktop visitor plays the game, with a mouse and with the keyboard', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
    await ctx.addInitScript(() => {
      localStorage.setItem('dovefall.v1', JSON.stringify({
        rev: 1, installId: '22222222-2222-2222-2222-222222222222',
        bests: {}, feathers: 0, owned: ['dove'], tutorialDone: true,
        name: 'Kifaru', tag: '4T7X', token: '', respawns: 0,
      }));
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}?api=${encodeURIComponent(base.replace(/\/$/, ''))}`, { waitUntil: 'networkidle' });

    // No gate, no override in the URL: straight to the title.
    await page.waitForSelector('text=DOVEFALL');
    await page.click('button:has-text("Fly")');
    await page.waitForSelector('text=CLICK TO FLAP');
    await shot(page, '14-desktop-ready');

    // A portrait game on a landscape screen is a centred column with the sky
    // either side. The playfield is the same 1080x1920 it is on a phone.
    const box = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return { w: parseFloat(c.style.width), h: parseFloat(c.style.height) };
    });
    const scale = Math.min(box.w / 1080, box.h / 1920);
    assert.ok(scale > 0.3, `scale ${scale}`);
    assert.equal(Math.round(box.h / scale), 1920, 'the world is still 1920 tall');

    // The mouse flaps. Count the recorded flaps rather than racing the
    // physics: at 120 Hz gravity cancels a flap in under 200 ms, and a
    // round-trip to the browser is not reliably faster than that.
    await page.mouse.click(640, 400);
    await page.waitForFunction(() => window.__dovefall.sim()?.phase === 'play');
    await page.waitForFunction(() => window.__dovefall.sim().flapTicks.length >= 1);
    const afterClick = await page.evaluate(() => window.__dovefall.sim().flapTicks.length);
    assert.ok(afterClick >= 1, 'the click reached the engine');

    // So does the space bar.
    await page.keyboard.press('Space');
    await page.waitForFunction(
      (n) => window.__dovefall.sim().flapTicks.length > n,
      afterClick,
      { timeout: 3000 },
    );

    // And it can actually be played to a score with the keyboard alone.
    let scored = 0;
    for (let i = 0; i < 900; i++) {
      const st = await page.evaluate(() => {
        const s = window.__dovefall.sim();
        if (!s || s.phase !== 'play') return null;
        const next = s.gates.find((g) => !g.passed);
        return { score: s.score, y: s.y, vy: s.vy, target: next ? next.top + next.gap * 0.5 : 806 };
      });
      if (!st) break;
      scored = st.score;
      if (scored >= 6) break;
      if (st.y > st.target && st.vy > -80) await page.keyboard.press('Space');
      await page.waitForTimeout(16);
    }
    assert.ok(scored >= 4, `keyboard play scored ${scored}`);
    await shot(page, '15-desktop-playing');

    assert.deepEqual(errors, [], 'no console errors on desktop');
    await ctx.close();
  });

  test('sideways, the PHONE is asked for back — a short desktop window is not', async () => {
    const { ctx, page } = await phone();
    await page.setViewportSize({ width: 745, height: 393 });
    await page.waitForSelector('text=Turn your phone upright');
    await shot(page, '16-rotate');
    await ctx.close();

    // The same shape on a desktop is just a short window, and must be left
    // alone: a mouse does not need a 44 px touch target, and the reader has no
    // phone to turn.
    const desk = await browser.newContext({
      viewport: { width: 900, height: 420 }, isMobile: false, hasTouch: false,
    });
    const dp = await desk.newPage();
    await dp.goto(base, { waitUntil: 'networkidle' });
    await dp.waitForSelector('#root h1, #root button');
    assert.equal(
      await dp.evaluate(() => document.body.classList.contains('cramped')),
      false,
      'a short desktop window is not asked to rotate',
    );
    await desk.close();
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
      await page.click('button:has-text("Today")');
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
      assert.equal(m.gap, 936, `${d.name}: the opening gap is the same number`);
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
