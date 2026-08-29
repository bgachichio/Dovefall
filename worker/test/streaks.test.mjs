// Streaks, and the grace day that keeps them from punishing people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, call } from './harness.mjs';
import { advanceStreak, isAlive, isoWeek, daysBetween, milestoneFor } from '../src/streaks.js';
import { todayKey, dailySeed, seedCode } from '../src/rng.js';

/**
 * The test's own date maths, deliberately independent of the module under
 * test: a helper that shared an implementation with daysBetween could share
 * its bugs and agree with them.
 */
function shiftDay(dayKey, days) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}


const DEVICE = '11111111-1111-1111-1111-111111111111';

// ------------------------------------------------------------------ dates

test('day arithmetic crosses months, years and leap days', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29', 'leap year');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
});

test('the ISO week boundary is Monday, and it is stable', () => {
  // 2026-08-24 is a Monday; the whole week shares a key.
  const week = isoWeek('2026-08-24');
  for (const d of ['2026-08-24', '2026-08-27', '2026-08-30']) {
    assert.equal(isoWeek(d), week, `${d} should share the week`);
  }
  assert.notEqual(isoWeek('2026-08-31'), week, 'the next Monday starts a new week');
});

// ------------------------------------------------------------------ advance

const S = (current, lastDay, graceWeek = null, best = current) => ({ current, best, lastDay, graceWeek });

test('a first day starts at one', () => {
  const r = advanceStreak({}, '2026-08-24');
  assert.equal(r.current, 1);
  assert.equal(r.outcome, 'started');
});

test('a second run the same day changes nothing', () => {
  const r = advanceStreak(S(5, '2026-08-24'), '2026-08-24');
  assert.equal(r.current, 5);
  assert.equal(r.outcome, 'same_day');
  assert.equal(r.changed, false, 'no write for a second run today');
});

test('yesterday extends', () => {
  const r = advanceStreak(S(5, '2026-08-23'), '2026-08-24');
  assert.equal(r.current, 6);
  assert.equal(r.outcome, 'extended');
});

test('one missed day is forgiven, once a week', () => {
  const first = advanceStreak(S(9, '2026-08-22'), '2026-08-24');
  assert.equal(first.outcome, 'saved', 'a 40-day streak must survive one bad day');
  assert.equal(first.current, 10);
  assert.equal(first.graceWeek, isoWeek('2026-08-24'));

  // Same week, second slip: no grace left.
  const second = advanceStreak(S(10, '2026-08-24', first.graceWeek), '2026-08-26');
  assert.equal(second.outcome, 'broken');
  assert.equal(second.current, 1);
});

test('the grace refreshes with the new week', () => {
  const spent = isoWeek('2026-08-24');
  const r = advanceStreak(S(10, '2026-08-29', spent), '2026-08-31');
  assert.equal(isoWeek('2026-08-31'), '2026-W36');
  assert.notEqual(isoWeek('2026-08-31'), spent);
  assert.equal(r.outcome, 'saved', 'a new week restores the allowance');
});

test('two missed days is a real break', () => {
  const r = advanceStreak(S(40, '2026-08-20'), '2026-08-24');
  assert.equal(r.outcome, 'broken');
  assert.equal(r.current, 1);
  assert.equal(r.best, 40, 'the record survives the break');
});

test('the best is remembered across a break and beyond', () => {
  let s = S(1, '2026-08-01', null, 1);
  for (let i = 1; i < 12; i++) s = advanceStreak(s, shiftDay('2026-08-01', i));
  assert.equal(s.current, 12);
  assert.equal(s.best, 12);
  const broken = advanceStreak(s, '2026-09-15');
  assert.equal(broken.current, 1);
  assert.equal(broken.best, 12);
});

test('a day in the past cannot rewrite history', () => {
  const r = advanceStreak(S(7, '2026-08-24'), '2026-08-20');
  assert.equal(r.current, 7);
  assert.equal(r.changed, false);
});

test('aliveness is honest about the grace still being available', () => {
  assert.equal(isAlive(S(5, '2026-08-24'), '2026-08-24'), true, 'today');
  assert.equal(isAlive(S(5, '2026-08-23'), '2026-08-24'), true, 'yesterday');
  assert.equal(isAlive(S(5, '2026-08-22'), '2026-08-24'), true, 'grace unspent');
  assert.equal(
    isAlive(S(5, '2026-08-22', isoWeek('2026-08-24')), '2026-08-24'), false,
    'grace already spent this week',
  );
  assert.equal(isAlive(S(5, '2026-08-20'), '2026-08-24'), false, 'too far gone');
  assert.equal(isAlive({}, '2026-08-24'), false);
});

test('milestones are sparse enough to still mean something', () => {
  assert.equal(milestoneFor(7), 7);
  assert.equal(milestoneFor(30), 30);
  assert.equal(milestoneFor(8), null);
  assert.equal(milestoneFor(2), null);
});

// ------------------------------------------------------------------ end to end

async function guest(env) {
  const r = await call(worker, env, 'POST', '/v1/auth/guest', { body: { device_id: DEVICE, name: 'Streaker' } });
  return r.json;
}

const run = (over = {}) => ({
  mode: 'normal', score: 20, duration_ms: 45_000, seed: seedCode(0xd0fe), ...over,
});

test('a run starts the play streak and reports it', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const r = await call(worker, env, 'POST', '/v1/runs', { token, body: run() });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.streaks.play.current, 1);
  assert.equal(r.json.streaks.play.outcome, 'started');
  assert.equal(r.json.streaks.play.alive, true);
  assert.equal(r.json.streaks.daily.current, 0, 'the daily is its own streak');
});

test('a second run the same day writes nothing and reports same_day', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  await call(worker, env, 'POST', '/v1/runs', { token, body: run() });
  const again = await call(worker, env, 'POST', '/v1/runs', { token, body: run({ score: 25 }) });
  assert.equal(again.json.streaks.play.current, 1);
  assert.equal(again.json.streaks.play.outcome, 'same_day');
});

test('the daily challenge advances its own streak', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const r = await call(worker, env, 'POST', '/v1/runs', {
    token,
    body: run({ is_daily: true, seed: seedCode(dailySeed(todayKey())) }),
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.streaks.daily.current, 1);
  assert.equal(r.json.streaks.play.current, 1, 'a daily run also counts as playing');
});

test('/v1/me reports live streak state without advancing it', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  await call(worker, env, 'POST', '/v1/runs', { token, body: run() });

  const me = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(me.json.streaks.play.current, 1);
  assert.equal(me.json.streaks.play.alive, true);
  assert.equal(me.json.streaks.play.outcome, null, 'reading is not an event');
});

test('streaks travel with the account, not the device', async () => {
  const env = makeEnv();
  const first = await guest(env);
  await call(worker, env, 'POST', '/v1/runs', { token: first.token, body: run() });

  const { json: issued } = await call(worker, env, 'POST', '/v1/recovery/issue', { token: first.token });
  const moved = await call(worker, env, 'POST', '/v1/recovery/claim', {
    body: { code: issued.code, device_id: '22222222-2222-2222-2222-222222222222' },
  });
  const me = await call(worker, env, 'GET', '/v1/me', { token: moved.json.token });
  assert.equal(me.json.streaks.play.current, 1, 'a new phone keeps the streak');
});

test('the streak board ranks persistence, and hides banned players', async () => {
  const env = makeEnv();
  const { token, player } = await guest(env);
  await call(worker, env, 'POST', '/v1/runs', {
    token, body: run({ is_daily: true, seed: seedCode(dailySeed(todayKey())) }),
  });

  const r = await call(worker, env, 'GET', '/v1/board/streaks');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.entries.length, 1);
  assert.equal(r.json.entries[0].score, 1);
  assert.match(r.json.entries[0].tag, /^[0-9A-HJKMNP-TV-Z]{4}$/);

  env.DB._raw.prepare('UPDATE players SET banned = 1 WHERE id = ?').run(player.id);
  const after = await call(worker, env, 'GET', '/v1/board/streaks');
  assert.equal(after.json.entries.length, 0);
});

test('the streak board is public — a share link needs no account', async () => {
  const env = makeEnv();
  const r = await call(worker, env, 'GET', '/v1/board/streaks', {});
  assert.equal(r.status, 200);
});

test('a rejected run does not advance the streak', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const bad = await call(worker, env, 'POST', '/v1/runs', {
    token, body: run({ score: 900, duration_ms: 20_000 }),
  });
  assert.equal(bad.status, 422);
  const me = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(me.json.streaks.play.current, 0, 'cheating must not build a habit');
});
