// Staying under 80% of every free-tier ceiling, and cleaning up behind us.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, call } from './harness.mjs';
import { projectDaily, utilisation, shouldShed, LIMITS, SHED_AT, RETENTION_DAYS } from '../src/budget.js';
import { prune, measure, runMaintenance } from '../src/maintenance.js';

const DEVICE = '11111111-1111-1111-1111-111111111111';
const DAY = 86400;

async function guest(env) {
  const r = await call(worker, env, 'POST', '/v1/auth/guest', { body: { device_id: DEVICE, name: 'Budget' } });
  return r.json;
}

// ------------------------------------------------------------------ maths

test('a quiet morning is not mistaken for a crisis', () => {
  // Three writes at 00:05 must not project 864 and trip the alarm.
  assert.equal(projectDaily(3, 0.08), 3);
  assert.equal(projectDaily(50, 1.5), 50, 'held flat below two hours');
});

test('past the warm-up the projection is linear', () => {
  assert.equal(projectDaily(1000, 12), 2000);
  assert.equal(projectDaily(1000, 24), 1000);
  assert.equal(projectDaily(500, 6), 2000);
});

test('projection handles nonsense without throwing', () => {
  assert.equal(projectDaily(NaN, 5), 0);
  assert.equal(projectDaily(-5, 5), 0);
  assert.equal(projectDaily(100, -3), 100);
  assert.equal(projectDaily(100, 999), Math.round(100 * (24 / 24)));
});

test('the shed threshold is 80% of the write ceiling, and it holds', () => {
  assert.equal(SHED_AT, 0.8);
  const ceiling = LIMITS.d1_rows_written;
  assert.equal(shouldShed(Math.floor(ceiling * 0.79)), false);
  assert.equal(shouldShed(Math.ceil(ceiling * 0.8)), true);
  assert.equal(shouldShed(ceiling * 2), true);
  assert.equal(shouldShed(0), false);
});

test('utilisation is a clamped fraction, never a divide-by-zero', () => {
  assert.equal(utilisation(50, 100), 0.5);
  assert.equal(utilisation(0, 100), 0);
  assert.equal(utilisation(100, 0), 0);
  assert.ok(utilisation(1e9, 100) <= 9.99, 'clamped for display');
});

// ------------------------------------------------------------------ pruning

function seedOld(env, now) {
  const db = env.DB._raw;
  db.prepare("INSERT INTO players (id, name, created_at, last_seen_at) VALUES ('p1','Old',0,0)").run();

  const oldDay = new Date((now - (RETENTION_DAYS.daily + 5) * DAY) * 1000).toISOString().slice(0, 10);
  const freshDay = new Date(now * 1000).toISOString().slice(0, 10);
  const d = db.prepare('INSERT INTO daily (day, player_id, score, achieved_at) VALUES (?,?,?,?)');
  d.run(oldDay, 'p1', 10, now);
  d.run(freshDay, 'p1', 12, now);

  const r = db.prepare("INSERT INTO rejects (player_id, mode, score, duration_ms, reason, at) VALUES ('p1','normal',9,1,'too_fast',?)");
  r.run(now - (RETENTION_DAYS.rejects + 5) * DAY);
  r.run(now);

  const pay = db.prepare("INSERT INTO payments (reference, player_id, amount, currency, status, at) VALUES (?,'p1',5000,'KES','credited',?)");
  pay.run('old_ref', now - (RETENTION_DAYS.payments + 30) * DAY);
  pay.run('new_ref', now);
}

test('expired rows go, current rows stay, and bests are never touched', async () => {
  const env = makeEnv();
  const now = Math.floor(Date.now() / 1000);
  seedOld(env, now);
  env.DB._raw.prepare("INSERT INTO bests (player_id, mode, score, achieved_at) VALUES ('p1','normal',99,0)").run();

  const removed = await prune(env.DB, now);
  assert.equal(removed.daily, 1);
  assert.equal(removed.rejects, 1);
  assert.equal(removed.payments, 1);

  const c = (t) => env.DB._raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  assert.equal(c('daily'), 1, 'the current day survives');
  assert.equal(c('rejects'), 1);
  assert.equal(c('payments'), 1, 'the recent payment survives the audit window');
  assert.equal(c('bests'), 1, 'a personal best is never pruned — it is the point');
});

test('pruning is idempotent — a second run removes nothing', async () => {
  const env = makeEnv();
  const now = Math.floor(Date.now() / 1000);
  seedOld(env, now);
  await prune(env.DB, now);
  assert.deepEqual(await prune(env.DB, now), {});
});

test('orphaned devices and saves are swept up', async () => {
  const env = makeEnv();
  const now = Math.floor(Date.now() / 1000);
  const db = env.DB._raw;
  db.prepare("INSERT INTO players (id, name, created_at, last_seen_at) VALUES ('alive','A',0,0)").run();
  // Insert orphans directly, bypassing the FK the way a partial failure would.
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare("INSERT INTO devices (device_id, player_id, first_seen, last_seen) VALUES ('dead-dev','ghost',0,0)").run();
  db.prepare("INSERT INTO saves (player_id, rev, blob, updated_at) VALUES ('ghost',1,'{}',0)").run();
  db.exec('PRAGMA foreign_keys = ON');

  const removed = await prune(env.DB, now);
  assert.equal(removed.orphan_devices, 1);
  assert.equal(removed.orphan_saves, 1);
});

test('a single run cannot blow the write budget it exists to protect', async () => {
  const env = makeEnv();
  const now = Math.floor(Date.now() / 1000);
  const db = env.DB._raw;
  db.prepare("INSERT INTO players (id, name, created_at, last_seen_at) VALUES ('p1','Old',0,0)").run();
  const old = now - (RETENTION_DAYS.rejects + 10) * DAY;
  const ins = db.prepare("INSERT INTO rejects (player_id, mode, score, duration_ms, reason, at) VALUES ('p1','normal',9,1,'too_fast',?)");
  for (let i = 0; i < 2500; i++) ins.run(old);

  const removed = await prune(env.DB, now);
  assert.ok(removed.rejects <= 2000, `deleted ${removed.rejects}, cap is 2000`);
  assert.ok(env.DB._raw.prepare('SELECT COUNT(*) AS n FROM rejects').get().n > 0, 'the rest waits for the next hour');
});

// ------------------------------------------------------------------ measuring

test('measure records a projection and the shed flag', async () => {
  const env = makeEnv();
  const now = Math.floor(Date.now() / 1000);
  const { token } = await guest(env);
  await call(worker, env, 'POST', '/v1/runs', {
    token, body: { mode: 'normal', score: 20, duration_ms: 45_000, seed: 'D0FE' },
  });

  const m = await measure(env.DB, now);
  const row = env.DB._raw.prepare('SELECT * FROM ops WHERE day = ?').get(m.day);
  assert.ok(row, 'a row is written for today');
  assert.equal(row.shed, 0, 'a handful of writes is nowhere near the ceiling');
  assert.ok(row.est_storage_bytes > 0);
  assert.ok(m.projectedWrites >= 0);
});

test('the whole maintenance pass runs and reports', async () => {
  const env = makeEnv();
  const now = Math.floor(Date.now() / 1000);
  seedOld(env, now);
  const r = await runMaintenance(env.DB, now);
  assert.equal(r.removed.daily, 1);
  assert.equal(r.limits.d1_rows_written, 100_000);
  assert.ok(r.day);
});

// ------------------------------------------------------------------ shedding

test('health exposes the budget without a dashboard hunt', async () => {
  const env = makeEnv();
  const r = await call(worker, env, 'GET', '/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.budget.threshold_pct, 80);
  assert.equal(r.json.budget.d1_rows_written.limit, 100_000);
  assert.equal(r.json.budget.shedding, false);
});

test('past 80% the non-essential writes stop and the essential ones do not', async () => {
  const env = makeEnv();
  const now = Math.floor(Date.now() / 1000);
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  // The shed flag is cached for 60s per binding — that staleness is deliberate
  // in production — so it is set before the first request rather than midway.
  env.DB._raw
    .prepare('INSERT INTO ops (day, est_writes, shed, updated_at) VALUES (?,?,1,?)')
    .run(day, LIMITS.d1_rows_written, now);
  const { token } = await guest(env);

  // Establish a best directly, so the flag is already live for every request.
  env.DB._raw
    .prepare("INSERT INTO bests (player_id, mode, score, achieved_at) VALUES (?,'normal',20,?)")
    .run(env.DB._raw.prepare('SELECT id FROM players LIMIT 1').get().id, now);

  // Non-essential: a would-be-best rejection is no longer logged.
  const before = env.DB._raw.prepare('SELECT COUNT(*) AS n FROM rejects').get().n;
  const bad = await call(worker, env, 'POST', '/v1/runs', {
    token, body: { mode: 'normal', score: 900, duration_ms: 20_000, seed: 'D0FE' },
  });
  assert.equal(bad.status, 422, 'the run is still correctly refused');
  assert.equal(
    env.DB._raw.prepare('SELECT COUNT(*) AS n FROM rejects').get().n, before,
    'but logging it is shed',
  );

  // Essential: a personal best still lands.
  const good = await call(worker, env, 'POST', '/v1/runs', {
    token, body: { mode: 'normal', score: 55, duration_ms: 90_000, seed: 'D0FE' },
  });
  assert.equal(good.json.personal_best, true, 'a score is never shed');
  assert.equal(env.DB._raw.prepare('SELECT score FROM bests').get().score, 55);

  const health = await call(worker, env, 'GET', '/v1/health');
  assert.equal(health.json.budget.shedding, true, 'and it says so');
});

test('the save window widens rather than closing when shedding', async () => {
  const env = makeEnv();
  const now = Math.floor(Date.now() / 1000);
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  env.DB._raw
    .prepare('INSERT INTO ops (day, est_writes, shed, updated_at) VALUES (?,?,1,?)')
    .run(day, LIMITS.d1_rows_written, now);
  const { token } = await guest(env);

  await call(worker, env, 'PUT', '/v1/save', { token, body: { rev: 1, blob: 'a' } });

  const second = await call(worker, env, 'PUT', '/v1/save', { token, body: { rev: 2, blob: 'b' } });
  assert.equal(second.status, 429);
  assert.ok(second.json.retry_after > 30, 'the window widened past the normal 30s');
});
