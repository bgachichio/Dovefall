// End-to-end tests against the real Worker, the real schema and a real SQLite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, call } from './harness.mjs';
import { todayKey, dailySeed, seedCode } from '../src/rng.js';

const DEVICE = '11111111-2222-3333-4444-555555555555';

async function guest(env, device = DEVICE) {
  const r = await call(worker, env, 'POST', '/v1/auth/guest', { body: { device_id: device, name: 'Tester' } });
  assert.equal(r.status, 200, r.text);
  return r.json;
}

const goodRun = (over = {}) => ({
  mode: 'normal',
  score: 30,
  duration_ms: 60_000,
  seed: seedCode(0xd0fe),
  build: '0.1.0',
  playfield_h: 1920,
  flap_ticks: 'AAEC',
  ...over,
});

// ------------------------------------------------------------------ basics

test('health reports the day and the modes', async () => {
  const env = makeEnv();
  const r = await call(worker, env, 'GET', '/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.modes, ['easy', 'normal', 'hard', 'pro']);
});

test('a missing database binding fails loudly rather than silently', async () => {
  const r = await call(worker, { SESSION_SECRET: 'x' }, 'GET', '/v1/health');
  assert.equal(r.status, 500);
  assert.equal(r.json.error, 'not_configured');
});

test('unknown routes 404', async () => {
  const env = makeEnv();
  const r = await call(worker, env, 'GET', '/v1/nope');
  assert.equal(r.status, 404);
});

// ------------------------------------------------------------------ auth

test('a guest gets a player and a working token', async () => {
  const env = makeEnv();
  const { token, player } = await guest(env);
  assert.equal(player.guest, true);
  assert.equal(player.name, 'Tester');

  const me = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.json.player.id, player.id);
  assert.deepEqual(me.json.bests, []);
});

test('the same device returns the same player, not a new one', async () => {
  const env = makeEnv();
  const a = await guest(env);
  const b = await guest(env);
  assert.equal(a.player.id, b.player.id);
});

test('protected routes reject a missing or bad token', async () => {
  const env = makeEnv();
  for (const token of [undefined, 'garbage', 'v1.a.b']) {
    const r = await call(worker, env, 'GET', '/v1/me', { token });
    assert.equal(r.status, 401, `token ${token} should not have been accepted`);
  }
});

test('a malformed device id is refused', async () => {
  const env = makeEnv();
  for (const device_id of ['', 'short', 'not a uuid!!', 'x'.repeat(200)]) {
    const r = await call(worker, env, 'POST', '/v1/auth/guest', { body: { device_id } });
    assert.equal(r.status, 400, `accepted device id: ${device_id}`);
  }
});

test('google sign-in is refused when the server has no client id configured', async () => {
  const env = makeEnv({ GOOGLE_CLIENT_IDS: '' });
  const r = await call(worker, env, 'POST', '/v1/auth/google', { body: { id_token: 'a.b.c' } });
  assert.ok(r.status >= 400);
});

// ------------------------------------------------------------------ runs

test('a plausible run is accepted and becomes a personal best', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const r = await call(worker, env, 'POST', '/v1/runs', { token, body: goodRun() });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.accepted, true);
  assert.equal(r.json.personal_best, true);
});

test('a worse run is accepted but writes nothing', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  await call(worker, env, 'POST', '/v1/runs', { token, body: goodRun({ score: 30 }) });
  const r = await call(worker, env, 'POST', '/v1/runs', { token, body: goodRun({ score: 12 }) });
  assert.equal(r.json.accepted, true);
  assert.equal(r.json.personal_best, false, 'a worse score must not overwrite the best');

  const me = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(me.json.bests[0].score, 30);
});

test('an impossible run is rejected and recorded', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const r = await call(worker, env, 'POST', '/v1/runs', {
    token,
    body: goodRun({ score: 900, duration_ms: 30_000 }),
  });
  assert.equal(r.status, 422);
  assert.equal(r.json.accepted, false);
  assert.equal(r.json.reason, 'too_fast');

  const rejects = env.DB._raw.prepare('SELECT reason, score FROM rejects').all();
  assert.equal(rejects.length, 1, 'a would-be personal best that fails checks should be logged');
  assert.equal(rejects[0].reason, 'too_fast');
});

test('a failed run that would not have been a best is not written to rejects', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  await call(worker, env, 'POST', '/v1/runs', { token, body: goodRun({ score: 60, duration_ms: 90_000 }) });
  // Score 5 is below the stored best, so this is a broken client, not an attack.
  await call(worker, env, 'POST', '/v1/runs', { token, body: goodRun({ score: 5, duration_ms: 10 }) });
  const rejects = env.DB._raw.prepare('SELECT COUNT(*) AS n FROM rejects').get();
  assert.equal(rejects.n, 0);
});

test('Second Wind runs are refused from the board', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const r = await call(worker, env, 'POST', '/v1/runs', {
    token,
    body: goodRun({ second_wind_used: true }),
  });
  assert.equal(r.status, 422);
  assert.equal(r.json.reason, 'second_wind');
});

test('a daily run must carry the day’s seed', async () => {
  const env = makeEnv();
  const { token } = await guest(env);

  const wrong = await call(worker, env, 'POST', '/v1/runs', {
    token,
    body: goodRun({ is_daily: true, seed: seedCode(12345) }),
  });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.json.reason, 'wrong_daily_seed');

  const right = await call(worker, env, 'POST', '/v1/runs', {
    token,
    body: goodRun({ is_daily: true, seed: seedCode(dailySeed(todayKey())) }),
  });
  assert.equal(right.status, 200, right.text);
  assert.equal(right.json.daily_best, true);
});

test('an oversized replay log is refused', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const r = await call(worker, env, 'POST', '/v1/runs', {
    token,
    body: goodRun({ flap_ticks: 'A'.repeat(5000) }),
  });
  assert.equal(r.status, 413);
});

// ------------------------------------------------------------------ boards

test('the board ranks players and hides everything but name and score', async () => {
  const env = makeEnv();
  const low = await guest(env, '11111111-1111-1111-1111-111111111111');
  const high = await guest(env, '22222222-2222-2222-2222-222222222222');

  await call(worker, env, 'POST', '/v1/runs', { token: low.token, body: goodRun({ score: 20 }) });
  await call(worker, env, 'POST', '/v1/runs', { token: high.token, body: goodRun({ score: 55, duration_ms: 90_000 }) });

  const r = await call(worker, env, 'GET', '/v1/board/normal');
  assert.equal(r.status, 200);
  assert.equal(r.json.entries.length, 2);
  assert.equal(r.json.entries[0].score, 55);
  assert.equal(r.json.entries[0].rank, 1);
  assert.equal(r.json.entries[1].score, 20);
  assert.deepEqual(Object.keys(r.json.entries[0]).sort(), ['at', 'name', 'rank', 'score', 'tag']);
  assert.match(r.json.entries[0].tag, /^[0-9A-HJKMNP-TV-Z]{4}$/, 'every entry carries a discriminator tag');
});

test('a banned player disappears from the board', async () => {
  const env = makeEnv();
  const { token, player } = await guest(env);
  await call(worker, env, 'POST', '/v1/runs', { token, body: goodRun() });
  env.DB._raw.prepare('UPDATE players SET banned = 1 WHERE id = ?').run(player.id);

  const r = await call(worker, env, 'GET', '/v1/board/normal');
  assert.equal(r.json.entries.length, 0);

  const submit = await call(worker, env, 'POST', '/v1/runs', { token, body: goodRun({ score: 99 }) });
  assert.equal(submit.status, 403);
});

test('an unknown mode board 404s instead of returning an empty list', async () => {
  const env = makeEnv();
  const r = await call(worker, env, 'GET', '/v1/board/impossible');
  assert.equal(r.status, 404);
});

test('the daily board publishes the seed it is scored against', async () => {
  const env = makeEnv();
  const r = await call(worker, env, 'GET', '/v1/board/daily');
  assert.equal(r.status, 200);
  assert.equal(r.json.day, todayKey());
  assert.equal(r.json.seed, seedCode(dailySeed(todayKey())));
});

// ------------------------------------------------------------------ save

test('a save round-trips', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const put = await call(worker, env, 'PUT', '/v1/save', { token, body: { rev: 1, blob: '{"feathers":12}' } });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.rev, 1);

  const get = await call(worker, env, 'GET', '/v1/save', { token });
  assert.equal(get.json.rev, 1);
  assert.equal(get.json.blob, '{"feathers":12}');
});

test('a stale device cannot overwrite a newer save', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  await call(worker, env, 'PUT', '/v1/save', { token, body: { rev: 5, blob: 'new' } });
  const stale = await call(worker, env, 'PUT', '/v1/save', { token, body: { rev: 2, blob: 'old' } });
  assert.equal(stale.json.stored, false);

  const get = await call(worker, env, 'GET', '/v1/save', { token });
  assert.equal(get.json.blob, 'new');
  assert.equal(get.json.rev, 5);
});

test('an eager client is throttled rather than allowed to burn the write budget', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  await call(worker, env, 'PUT', '/v1/save', { token, body: { rev: 1, blob: 'a' } });
  const second = await call(worker, env, 'PUT', '/v1/save', { token, body: { rev: 2, blob: 'b' } });
  assert.equal(second.status, 429);
  assert.equal(second.json.throttled, true);
  assert.ok(second.json.retry_after > 0);
});

test('oversized and malformed saves are refused', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const big = await call(worker, env, 'PUT', '/v1/save', { token, body: { rev: 1, blob: 'x'.repeat(9000) } });
  assert.equal(big.status, 413);
  for (const body of [{ rev: 0, blob: 'a' }, { rev: 1 }, { rev: 'one', blob: 'a' }]) {
    const r = await call(worker, env, 'PUT', '/v1/save', { token, body });
    assert.equal(r.status, 400, `accepted bad save: ${JSON.stringify(body)}`);
  }
});

// ------------------------------------------------------------------ erasure

test('deleting an account really removes the rows', async () => {
  const env = makeEnv();
  const { token, player } = await guest(env);
  await call(worker, env, 'POST', '/v1/runs', { token, body: goodRun() });
  await call(worker, env, 'PUT', '/v1/save', { token, body: { rev: 1, blob: 'a' } });

  const del = await call(worker, env, 'DELETE', '/v1/me', { token });
  assert.equal(del.status, 200);
  assert.equal(del.json.deleted, true);

  for (const table of ['players', 'bests', 'saves']) {
    const { n } = env.DB._raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
    assert.equal(n, 0, `${table} still holds rows after erasure`);
  }
  const after = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(after.status, 401, 'the session must stop working once the player is gone');
  assert.ok(player.id);
});

// ------------------------------------------------------------------ CORS

test('CORS echoes only allowed origins, never a wildcard', async () => {
  const env = makeEnv();
  const ok = await call(worker, env, 'GET', '/v1/health', { origin: 'https://dovefall.pages.dev' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://dovefall.pages.dev');

  const bad = await call(worker, env, 'GET', '/v1/health', { origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('preflight is answered', async () => {
  const env = makeEnv();
  const r = await call(worker, env, 'OPTIONS', '/v1/runs', { origin: 'https://dovefall.pages.dev' });
  assert.equal(r.status, 204);
  assert.match(r.headers.get('access-control-allow-methods'), /POST/);
});

// ------------------------------------------------------------------ body guards

test('a body that is not a JSON object is refused', async () => {
  const env = makeEnv();
  const res = await worker.fetch(
    new Request('https://api.test/v1/auth/guest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"just a string"',
    }),
    env,
    {},
  );
  assert.equal(res.status, 400);
});
