// Identity without email addresses: a chosen name, a device-held id, and a
// written-down code that is the only way back after a lost phone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, call } from './harness.mjs';
import { tagFor, mintRecoveryCode, normaliseRecoveryCode } from '../src/auth.js';

const DEV_A = '11111111-1111-1111-1111-111111111111';
const DEV_B = '22222222-2222-2222-2222-222222222222';

async function guest(env, device, name = 'Tester') {
  const r = await call(worker, env, 'POST', '/v1/auth/guest', { body: { device_id: device, name } });
  assert.equal(r.status, 200, r.text);
  return r.json;
}

// ------------------------------------------------------------------ names

test('a player can choose and change their name', async () => {
  const env = makeEnv();
  const { token } = await guest(env, DEV_A, 'First');

  const r = await call(worker, env, 'PUT', '/v1/me/name', { token, body: { name: '  Brian  ' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.player.name, 'Brian');

  const me = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(me.json.player.name, 'Brian');
});

test('an empty or invisible name is refused rather than silently defaulted', async () => {
  const env = makeEnv();
  const { token } = await guest(env, DEV_A);
  for (const name of ['', '   ', null, 42]) {
    const r = await call(worker, env, 'PUT', '/v1/me/name', { token, body: { name } });
    assert.equal(r.status, 400, `accepted name: ${JSON.stringify(name)}`);
  }
});

test('names are not unique, and the tag is what tells two Brians apart', async () => {
  const env = makeEnv();
  const a = await guest(env, DEV_A, 'Brian');
  const b = await guest(env, DEV_B, 'Brian');

  assert.equal(a.player.name, b.player.name);
  assert.notEqual(a.player.tag, b.player.tag, 'two players sharing a name need distinct tags');
});

test('the tag is stable across sessions and derived, not stored', async () => {
  const env = makeEnv();
  const first = await guest(env, DEV_A);
  const second = await guest(env, DEV_A);
  assert.equal(first.player.tag, second.player.tag);
  assert.equal(first.player.tag, tagFor(first.player.id));
});

test('tags avoid the characters people misread', () => {
  for (let i = 0; i < 3000; i++) {
    assert.match(tagFor(`player-${i}-${i * 7919}`), /^[0-9A-HJKMNP-TV-Z]{4}$/);
  }
});

// ------------------------------------------------------------------ codes

test('a recovery code is issued once and shown once', async () => {
  const env = makeEnv();
  const { token } = await guest(env, DEV_A);

  const r = await call(worker, env, 'POST', '/v1/recovery/issue', { token });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);

  // Only the hash is kept, never the code itself.
  const row = env.DB._raw.prepare('SELECT recovery_hash FROM players').get();
  assert.ok(row.recovery_hash);
  assert.ok(!row.recovery_hash.includes(r.json.code.replace(/-/g, '')));

  const me = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(me.json.player.has_recovery_code, true);
});

test('a code moves the account to a new device, with its scores', async () => {
  const env = makeEnv();
  const old = await guest(env, DEV_A, 'Brian');
  await call(worker, env, 'POST', '/v1/runs', {
    token: old.token,
    body: { mode: 'normal', score: 42, duration_ms: 70_000, seed: 'D0FE' },
  });
  const { json: issued } = await call(worker, env, 'POST', '/v1/recovery/issue', { token: old.token });

  const claim = await call(worker, env, 'POST', '/v1/recovery/claim', {
    body: { code: issued.code, device_id: DEV_B },
  });
  assert.equal(claim.status, 200, claim.text);
  assert.equal(claim.json.player.id, old.player.id, 'the same account, not a new one');
  assert.equal(claim.json.player.name, 'Brian');

  const me = await call(worker, env, 'GET', '/v1/me', { token: claim.json.token });
  assert.equal(me.json.bests[0].score, 42, 'scores travel with the account');
});

test('claiming signs the old device out — the point of doing it after a theft', async () => {
  const env = makeEnv();
  const old = await guest(env, DEV_A);
  const { json: issued } = await call(worker, env, 'POST', '/v1/recovery/issue', { token: old.token });
  await call(worker, env, 'POST', '/v1/recovery/claim', {
    body: { code: issued.code, device_id: DEV_B },
  });

  const stale = await call(worker, env, 'GET', '/v1/me', { token: old.token });
  assert.equal(stale.status, 401);
  assert.equal(stale.json.error, 'session_superseded');
});

test('a code works only once', async () => {
  const env = makeEnv();
  const old = await guest(env, DEV_A);
  const { json: issued } = await call(worker, env, 'POST', '/v1/recovery/issue', { token: old.token });

  await call(worker, env, 'POST', '/v1/recovery/claim', { body: { code: issued.code, device_id: DEV_B } });
  const again = await call(worker, env, 'POST', '/v1/recovery/claim', {
    body: { code: issued.code, device_id: '33333333-3333-3333-3333-333333333333' },
  });
  assert.equal(again.status, 404);
  assert.equal(again.json.error, 'no_such_code');
});

test('issuing a new code invalidates the previous one', async () => {
  const env = makeEnv();
  const { token } = await guest(env, DEV_A);
  const first = (await call(worker, env, 'POST', '/v1/recovery/issue', { token })).json.code;
  const second = (await call(worker, env, 'POST', '/v1/recovery/issue', { token })).json.code;
  assert.notEqual(first, second);

  const stale = await call(worker, env, 'POST', '/v1/recovery/claim', {
    body: { code: first, device_id: DEV_B },
  });
  assert.equal(stale.status, 404);

  const fresh = await call(worker, env, 'POST', '/v1/recovery/claim', {
    body: { code: second, device_id: DEV_B },
  });
  assert.equal(fresh.status, 200);
});

test('an unknown or malformed code is refused', async () => {
  const env = makeEnv();
  await guest(env, DEV_A);
  const bad = await call(worker, env, 'POST', '/v1/recovery/claim', {
    body: { code: 'ZZZZZ-ZZZZZ-ZZZZZ', device_id: DEV_B },
  });
  assert.equal(bad.status, 404);

  for (const code of ['', 'nope', null, 'ABC-DEF']) {
    const r = await call(worker, env, 'POST', '/v1/recovery/claim', { body: { code, device_id: DEV_B } });
    assert.equal(r.status, 400, `accepted code: ${JSON.stringify(code)}`);
  }
});

test('transcription slips are forgiven — O for 0, I and L for 1', () => {
  const canonical = '0123456789ABCDE';
  assert.equal(normaliseRecoveryCode('01234-56789-ABCDE'), canonical);
  assert.equal(normaliseRecoveryCode('0l234-56789-abcde'), canonical, 'lowercase L reads as one');
  assert.equal(normaliseRecoveryCode('OI234 56789 ABCDE'), canonical, 'O reads as zero, I as one');
  assert.equal(normaliseRecoveryCode('  01234--56789--abcde  '), canonical, 'punctuation and case are noise');
  assert.equal(normaliseRecoveryCode('too short'), null);
});

test('minted codes always normalise back to themselves', () => {
  for (let i = 0; i < 500; i++) {
    const code = mintRecoveryCode();
    assert.equal(normaliseRecoveryCode(code), code.replace(/-/g, ''));
  }
});

test('restoring onto a device with an empty guest clears it away', async () => {
  const env = makeEnv();
  const old = await guest(env, DEV_A, 'Brian');
  const { json: issued } = await call(worker, env, 'POST', '/v1/recovery/issue', { token: old.token });

  // The new phone was played as a guest before the code was entered.
  const throwaway = await guest(env, DEV_B, 'Curious');
  await call(worker, env, 'POST', '/v1/recovery/claim', { body: { code: issued.code, device_id: DEV_B } });

  const gone = env.DB._raw.prepare('SELECT COUNT(*) AS n FROM players WHERE id = ?').get(throwaway.player.id);
  assert.equal(gone.n, 0, 'an empty throwaway guest should not linger');
  const owner = env.DB._raw
    .prepare('SELECT player_id FROM devices WHERE device_id = ?').get(DEV_B);
  assert.equal(owner.player_id, old.player.id, 'the new device now belongs to the restored account');
});

test('a guest with scores is unbound, never destroyed', async () => {
  const env = makeEnv();
  const old = await guest(env, DEV_A, 'Brian');
  const { json: issued } = await call(worker, env, 'POST', '/v1/recovery/issue', { token: old.token });

  const other = await guest(env, DEV_B, 'HasProgress');
  await call(worker, env, 'POST', '/v1/runs', {
    token: other.token,
    body: { mode: 'normal', score: 15, duration_ms: 40_000, seed: 'D0FE' },
  });

  await call(worker, env, 'POST', '/v1/recovery/claim', { body: { code: issued.code, device_id: DEV_B } });

  const kept = env.DB._raw.prepare('SELECT id FROM players WHERE id = ?').get(other.player.id);
  assert.ok(kept, 'a player with scores must survive');
  const stillMine = env.DB._raw
    .prepare('SELECT COUNT(*) AS n FROM devices WHERE player_id = ?').get(other.player.id);
  assert.equal(stillMine.n, 0, 'but its device binding moves on');
});

test('issuing a code requires being signed in', async () => {
  const env = makeEnv();
  const r = await call(worker, env, 'POST', '/v1/recovery/issue', {});
  assert.equal(r.status, 401);
});
