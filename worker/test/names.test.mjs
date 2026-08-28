import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, makeDb, call } from './harness.mjs';
import { suggestNames, randomName, WORD_COUNTS } from '../src/names.js';

const DEVICE = '11111111-1111-1111-1111-111111111111';

async function guest(env) {
  const r = await call(worker, env, 'POST', '/v1/auth/guest', { body: { device_id: DEVICE } });
  return r.json;
}

test('the endpoint offers three distinct suggestions and requires a session', async () => {
  const env = makeEnv();
  const anon = await call(worker, env, 'GET', '/v1/names/suggest', {});
  assert.equal(anon.status, 401);

  const { token } = await guest(env);
  const r = await call(worker, env, 'GET', '/v1/names/suggest', { token });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.suggestions.length, 3);
  assert.equal(new Set(r.json.suggestions).size, 3);
  for (const name of r.json.suggestions) {
    assert.ok(name.length >= 1 && name.length <= 24, `name too long for the 24-char field: ${name}`);
  }
});

test('a name someone already holds is never offered', async () => {
  const db = makeDb();
  // Deterministic generator that proposes the same name over and over, then
  // one alternative: proves the availability check is consulted, not decorative.
  let n = 0;
  const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.9, 0.2, 0.7, 0.4, 0.3].map((v) => v);
  const rand = () => seq[n++ % seq.length];

  const taken = randomName(() => 0);
  db._raw.prepare(
    "INSERT INTO players (id, name, created_at, last_seen_at) VALUES ('p1', ?, 0, 0)",
  ).run(taken);

  const out = await suggestNames(db, { rand });
  assert.equal(out.length, 3);
  assert.ok(!out.includes(taken), `offered a taken name: ${taken}`);
});

test('suggestions keep flowing when the plain combinations are exhausted', async () => {
  const db = makeDb();
  const ins = db._raw.prepare(
    'INSERT INTO players (id, name, created_at, last_seen_at) VALUES (?, ?, 0, 0)',
  );
  // Occupy every plain combination, so only suffixed names remain free.
  let i = 0;
  const seen = new Set();
  for (let a = 0; a < WORD_COUNTS.first; a++) {
    for (let b = 0; b < WORD_COUNTS.second; b++) {
      const first = randomName(() => a / WORD_COUNTS.first).split(' ')[0];
      const second = randomName(() => b / WORD_COUNTS.second).split(' ')[1];
      const name = `${first} ${second}`;
      if (!seen.has(name)) {
        seen.add(name);
        ins.run(`p${i++}`, name);
      }
    }
  }
  assert.equal(seen.size, WORD_COUNTS.first * WORD_COUNTS.second);

  const out = await suggestNames(db);
  assert.equal(out.length, 3, 'suffixed fallbacks must keep suggestions coming');
  for (const name of out) {
    assert.match(name, /\d{2}$/, `expected a suffixed fallback, got: ${name}`);
    assert.ok(name.length <= 24, `fallback exceeds the field: ${name}`);
  }
});
