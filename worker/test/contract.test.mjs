// The contract between this Worker and `game/src/net/api.ts`.
//
// These are not tests of behaviour — api.test.mjs covers that. They pin the
// SHAPE of every response the game reads, because the two halves ship
// separately and a renamed field between them fails silently: `undefined` is a
// perfectly valid thing to destructure, store, and render.
//
// That is not hypothetical. Every assertion below stands for a bug that was
// live on the phone:
//
//   player nesting      the chosen name never saved, and every boot wiped it
//   `suggestions`       the first-run name screen had nothing to offer
//   `balance`           the respawn counter read ♥0 forever
//   `pay_link`          "Pay with Paystack" opened about:blank
//   `x-dovefall-device` "sign out my other device" returned 400 every time
//
// If you rename a field here, rename it in api.ts in the same commit — and if
// you cannot, version the endpoint instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, call } from './harness.mjs';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DEVICE2 = '99999999-8888-7777-6666-555555555555';

/** Asserts every named key is present — not merely that the object exists. */
function hasKeys(obj, keys, where) {
  assert.ok(obj && typeof obj === 'object', `${where}: expected an object, got ${JSON.stringify(obj)}`);
  for (const k of keys) {
    assert.ok(k in obj, `${where}: api.ts reads "${k}", which this response does not contain`);
  }
}

async function guest(env, device = DEVICE, name = 'Tester') {
  const r = await call(worker, env, 'POST', '/v1/auth/guest', { body: { device_id: device, name } });
  assert.equal(r.status, 200, r.text);
  return r.json;
}

test('POST /v1/auth/guest nests the player and returns a token', async () => {
  const env = makeEnv();
  const r = await guest(env);
  hasKeys(r, ['token', 'player'], 'auth/guest');
  hasKeys(r.player, ['id', 'name', 'tag', 'respawns'], 'auth/guest.player');
  assert.equal(typeof r.token, 'string');
  assert.equal(r.player.name, 'Tester');
  assert.match(r.player.tag, /^[A-Z0-9]{4}$/);
});

test('GET /v1/me nests the player and carries both streaks', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const r = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(r.status, 200, r.text);
  hasKeys(r.json, ['player', 'streaks'], 'me');
  hasKeys(r.json.player, ['id', 'name', 'tag', 'respawns'], 'me.player');
  hasKeys(r.json.streaks, ['play', 'daily'], 'me.streaks');
  hasKeys(r.json.streaks.play, ['current', 'best', 'alive', 'outcome'], 'me.streaks.play');
});

test('PUT /v1/me/name returns the renamed player, nested', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const r = await call(worker, env, 'PUT', '/v1/me/name', { token, body: { name: 'Marley' } });
  assert.equal(r.status, 200, r.text);
  hasKeys(r.json, ['player'], 'me/name');
  hasKeys(r.json.player, ['id', 'name', 'tag'], 'me/name.player');
  assert.equal(r.json.player.name, 'Marley');

  // And it must survive a re-read: a 200 that did not persist is worse than a
  // failure, because the screen says "Saved".
  const back = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(back.json.player.name, 'Marley');
});

test('GET /v1/names/suggest returns `suggestions`, never `names`', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const r = await call(worker, env, 'GET', '/v1/names/suggest', { token });
  assert.equal(r.status, 200, r.text);
  hasKeys(r.json, ['suggestions'], 'names/suggest');
  assert.ok(Array.isArray(r.json.suggestions));
  assert.ok(r.json.suggestions.length > 0, 'an empty suggestion list renders as a dead screen');
});

test('GET /v1/respawns returns balance, pay_code and pay_link', async () => {
  const env = makeEnv({ PAYSTACK_LINK: 'https://paystack.shop/pay/dovefall' });
  const { token } = await guest(env);
  const r = await call(worker, env, 'GET', '/v1/respawns', { token });
  assert.equal(r.status, 200, r.text);
  hasKeys(r.json, ['balance', 'pay_code', 'pay_link', 'per_payment', 'min_kes'], 'respawns');
  assert.equal(typeof r.json.balance, 'number');
  assert.match(r.json.pay_code, /^[A-Z0-9]{8}$/);
  assert.equal(r.json.pay_link, 'https://paystack.shop/pay/dovefall');
});

test('GET /v1/respawns reports pay_link as null when none is configured', async () => {
  // The game hides the pay button on null. It must never be the string
  // "undefined", which is what a missing var reads as once interpolated.
  const env = makeEnv({ PAYSTACK_LINK: '' });
  const { token } = await guest(env);
  const r = await call(worker, env, 'GET', '/v1/respawns', { token });
  assert.equal(r.json.pay_link, null);
});

test('POST /v1/respawns/spend reports the new balance', async () => {
  const env = makeEnv();
  const { token, player } = await guest(env);
  env.DB.prepare('UPDATE players SET respawns = 2 WHERE id = ?1').bind(player.id).run();
  const r = await call(worker, env, 'POST', '/v1/respawns/spend', { token });
  assert.equal(r.status, 200, r.text);
  hasKeys(r.json, ['ok', 'balance'], 'respawns/spend');
  assert.equal(r.json.balance, 1);
});

test('POST /v1/runs returns the accept flags and both streaks', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const r = await call(worker, env, 'POST', '/v1/runs', {
    token,
    body: {
      mode: 'normal', score: 12, duration_ms: 30_000, seed: 'D0FE',
      build: 'web-0.1.0', playfield_h: 1920, flap_ticks: 'AAEC', is_daily: false,
    },
  });
  assert.equal(r.status, 200, r.text);
  hasKeys(r.json, ['accepted', 'personal_best', 'daily_best', 'streaks'], 'runs');
  hasKeys(r.json.streaks.play, ['current', 'best', 'alive', 'outcome'], 'runs.streaks.play');
});

test('the boards return `entries` with rank, name, tag and score', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  await call(worker, env, 'POST', '/v1/runs', {
    token,
    body: {
      mode: 'normal', score: 12, duration_ms: 30_000, seed: 'D0FE',
      build: 'web-0.1.0', playfield_h: 1920, flap_ticks: 'AAEC', is_daily: false,
    },
  });
  const r = await call(worker, env, 'GET', '/v1/board/normal?limit=5');
  assert.equal(r.status, 200, r.text);
  hasKeys(r.json, ['entries'], 'board');
  hasKeys(r.json.entries[0], ['rank', 'name', 'tag', 'score'], 'board.entries[0]');

  // The game matches its own row by name AND tag. Both must come back, or the
  // player sees a stranger at the top and a second copy of themselves below.
  assert.equal(r.json.entries[0].name, 'Tester');
  assert.match(r.json.entries[0].tag, /^[A-Z0-9]{4}$/);
});

test('POST /v1/recovery/claim nests the player alongside the new token', async () => {
  const env = makeEnv();
  const { token } = await guest(env);
  const issued = await call(worker, env, 'POST', '/v1/recovery/issue', { token });
  hasKeys(issued.json, ['code'], 'recovery/issue');

  const r = await call(worker, env, 'POST', '/v1/recovery/claim', {
    body: { code: issued.json.code, device_id: DEVICE2 },
  });
  assert.equal(r.status, 200, r.text);
  hasKeys(r.json, ['token', 'player'], 'recovery/claim');
  hasKeys(r.json.player, ['id', 'name', 'tag'], 'recovery/claim.player');
});

test('DELETE /v1/devices with no body signs out the others and keeps this one', async () => {
  const env = makeEnv();
  const a = await guest(env, DEVICE);

  // A second phone joins the SAME account the only way the game offers: a
  // recovery code. Signing in as a guest on a new device id makes a new player.
  const issued = await call(worker, env, 'POST', '/v1/recovery/issue', { token: a.token });
  const claimed = await call(worker, env, 'POST', '/v1/recovery/claim', {
    body: { code: issued.json.code, device_id: DEVICE2 },
  });
  assert.equal(claimed.status, 200, claimed.text);

  const before = await call(worker, env, 'GET', '/v1/devices', { token: claimed.json.token, device: DEVICE2 });
  assert.equal(before.json.devices.length, 2, 'the account should now be on two phones');
  assert.ok(before.json.devices.some((d) => d.this_device), 'the header should mark one device as this one');

  const r = await call(worker, env, 'DELETE', '/v1/devices', {
    token: claimed.json.token,
    device: DEVICE2,
  });
  assert.equal(r.status, 200, r.text);
  hasKeys(r.json, ['removed', 'count', 'token'], 'devices DELETE');
  assert.equal(r.json.removed, true);
  assert.equal(r.json.count, 1);

  // The token handed back must still work — the caller signed the OTHERS out.
  const after = await call(worker, env, 'GET', '/v1/me', { token: r.json.token, device: DEVICE2 });
  assert.equal(after.status, 200, 'the device that signed the others out was signed out itself');

  const left = await call(worker, env, 'GET', '/v1/devices', { token: r.json.token, device: DEVICE2 });
  assert.equal(left.json.devices.length, 1);
});

test('DELETE /v1/devices refuses rather than detaching every device blind', async () => {
  const env = makeEnv();
  const a = await guest(env, DEVICE);
  const r = await call(worker, env, 'DELETE', '/v1/devices', { token: a.token });
  assert.equal(r.status, 400, 'a caller that cannot say which phone it is must not sign everyone out');
  const still = await call(worker, env, 'GET', '/v1/me', { token: a.token });
  assert.equal(still.status, 200);
});

test('the device header is on the CORS allow-list', async () => {
  // The browser refuses to send a header the preflight did not permit, and a
  // blocked preflight looks exactly like "the server is down".
  const env = makeEnv();
  const r = await call(worker, env, 'OPTIONS', '/v1/me', { origin: 'https://dovefall.pages.dev' });
  const allowed = (r.headers.get('access-control-allow-headers') || '').toLowerCase();
  for (const h of ['authorization', 'content-type', 'x-dovefall-device']) {
    assert.ok(allowed.includes(h), `preflight does not allow "${h}"`);
  }
});
