// Two devices per account, and the third one in evicts the oldest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, call } from './harness.mjs';
import { MAX_DEVICES } from '../src/store.js';

const PHONE  = '11111111-1111-1111-1111-111111111111';
const LAPTOP = '22222222-2222-2222-2222-222222222222';
const TABLET = '33333333-3333-3333-3333-333333333333';

async function guest(env, device, name = 'Tester') {
  const r = await call(worker, env, 'POST', '/v1/auth/guest', { body: { device_id: device, name } });
  assert.equal(r.status, 200, r.text);
  return r.json;
}

/** Move a device onto an existing account the way a player would: recovery code. */
async function addDevice(env, token, device) {
  const { json } = await call(worker, env, 'POST', '/v1/recovery/issue', { token });
  const r = await call(worker, env, 'POST', '/v1/recovery/claim', {
    body: { code: json.code, device_id: device },
  });
  assert.equal(r.status, 200, r.text);
  return r.json;
}

function deviceRows(env, playerId) {
  return env.DB._raw
    .prepare('SELECT device_id FROM devices WHERE player_id = ? ORDER BY last_seen ASC')
    .all(playerId)
    .map((r) => r.device_id);
}

test('the cap is two', () => {
  assert.equal(MAX_DEVICES, 2);
});

test('a second device joins the account and both keep working', async () => {
  const env = makeEnv();
  const first = await guest(env, PHONE, 'Brian');
  await call(worker, env, 'POST', '/v1/runs', {
    token: first.token,
    body: { mode: 'normal', score: 33, duration_ms: 70_000, seed: 'D0FE' },
  });

  const second = await addDevice(env, first.token, LAPTOP);
  assert.equal(second.player.id, first.player.id, 'same account, not a new one');
  assert.equal(second.devices, 2);

  assert.deepEqual(deviceRows(env, first.player.id).sort(), [PHONE, LAPTOP].sort());

  // The laptop sees the phone's score.
  const me = await call(worker, env, 'GET', '/v1/me', { token: second.token });
  assert.equal(me.json.bests[0].score, 33);
});

test('a third device evicts the one used longest ago', async () => {
  const env = makeEnv();
  const first = await guest(env, PHONE, 'Brian');
  const second = await addDevice(env, first.token, LAPTOP);
  const third = await addDevice(env, second.token, TABLET);

  const rows = deviceRows(env, first.player.id);
  assert.equal(rows.length, 2, 'never more than two');
  assert.ok(rows.includes(TABLET), 'the newest device is in');
  assert.ok(!rows.includes(PHONE), 'the oldest device is out');
  assert.ok(third.player.id === first.player.id);
});

test('an evicted device is signed out, not merely forgotten', async () => {
  const env = makeEnv();
  const first = await guest(env, PHONE);
  const second = await addDevice(env, first.token, LAPTOP);
  await addDevice(env, second.token, TABLET);

  const stale = await call(worker, env, 'GET', '/v1/me', { token: first.token });
  assert.equal(stale.status, 401, 'the evicted phone must lose its session');
});

test('the guest route on an evicted device starts a fresh account, not a hijack', async () => {
  const env = makeEnv();
  const first = await guest(env, PHONE, 'Brian');
  const second = await addDevice(env, first.token, LAPTOP);
  await addDevice(env, second.token, TABLET);

  const again = await guest(env, PHONE, 'Brian');
  assert.notEqual(again.player.id, first.player.id, 'an evicted device is a stranger again');
});

test('devices are listed without echoing the ids back', async () => {
  const env = makeEnv();
  const first = await guest(env, PHONE);
  // Claiming rotates the session epoch, so the newest token is the live one.
  const second = await addDevice(env, first.token, LAPTOP);

  const r = await call(worker, env, 'GET', '/v1/devices', { token: second.token });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.max, 2);
  assert.equal(r.json.devices.length, 2);
  for (const d of r.json.devices) {
    assert.match(d.id_hint, /^[0-9A-F]{4}$/);
    assert.ok(!JSON.stringify(d).includes(PHONE), 'a full device id must never be echoed');
    assert.ok(!JSON.stringify(d).includes(LAPTOP), 'a full device id must never be echoed');
  }
});

test('a player can drop a device, which signs it out', async () => {
  const env = makeEnv();
  const first = await guest(env, PHONE);
  const second = await addDevice(env, first.token, LAPTOP);

  const gone = await call(worker, env, 'DELETE', '/v1/devices', {
    token: second.token,
    body: { device_id: PHONE },
  });
  assert.equal(gone.status, 200);
  assert.equal(gone.json.removed, true);

  assert.deepEqual(deviceRows(env, first.player.id), [LAPTOP]);

  // The device that did the removing stays signed in, on the token it was handed.
  assert.ok(gone.json.token, 'the caller must be handed a token at the new epoch');
  const still = await call(worker, env, 'GET', '/v1/me', { token: gone.json.token });
  assert.equal(still.status, 200, 'removing another device must not sign me out');

  // Every other session is now dead.
  const stale = await call(worker, env, 'GET', '/v1/me', { token: second.token });
  assert.equal(stale.status, 401, 'the dropped device loses its session');
});

test('dropping a device that is not yours does nothing', async () => {
  const env = makeEnv();
  const mine = await guest(env, PHONE);
  await guest(env, LAPTOP);
  const r = await call(worker, env, 'DELETE', '/v1/devices', {
    token: mine.token,
    body: { device_id: LAPTOP },
  });
  assert.equal(r.json.removed, false);
  assert.deepEqual(deviceRows(env, mine.player.id), [PHONE]);
});

test('re-authenticating an already-bound device does not consume a slot', async () => {
  const env = makeEnv();
  const first = await guest(env, PHONE);
  await addDevice(env, first.token, LAPTOP);
  for (let i = 0; i < 5; i++) await guest(env, PHONE);
  assert.equal(deviceRows(env, first.player.id).length, 2);
});

test('malformed device ids are refused by the drop route', async () => {
  const env = makeEnv();
  const { token } = await guest(env, PHONE);
  for (const device_id of ['', 'nope', null]) {
    const r = await call(worker, env, 'DELETE', '/v1/devices', { token, body: { device_id } });
    assert.equal(r.status, 400, `accepted: ${JSON.stringify(device_id)}`);
  }
});
