import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSession, readSession, bearer, cleanName } from '../src/auth.js';

const env = { SESSION_SECRET: 'test-secret-not-the-real-one' };
const other = { SESSION_SECRET: 'a-different-secret' };

test('a freshly issued session verifies', async () => {
  const token = await issueSession('player-1', env);
  const s = await readSession(token, env);
  assert.equal(s.playerId, 'player-1');
  assert.equal(s.epoch, 1);
});

test('the session carries the epoch it was minted at', async () => {
  const s = await readSession(await issueSession('player-1', env, 7), env);
  assert.equal(s.epoch, 7);
});

test('a token signed with another secret is refused', async () => {
  const token = await issueSession('player-1', other);
  assert.equal(await readSession(token, env), null);
});

test('a tampered payload is refused', async () => {
  const token = await issueSession('player-1', env);
  const [v, payload, sig] = token.split('.');
  // Re-encode the payload with a different player id, keeping the old signature.
  const forged = Buffer.from(JSON.stringify({ p: 'player-2', e: 2 ** 40 }))
    .toString('base64url');
  assert.equal(await readSession(`${v}.${forged}.${sig}`, env), null);
  assert.notEqual(payload, forged);
});

test('an expired session is refused', async () => {
  const past = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 400;
  const token = await issueSession('player-1', env, 1, past);
  assert.equal(await readSession(token, env), null);
});

test('junk is refused without throwing', async () => {
  for (const bad of [null, undefined, '', 'x', 'v1.a', 'v2.a.b', 'v1.!!.??', 42]) {
    assert.equal(await readSession(bad, env), null, `accepted junk: ${bad}`);
  }
});

test('bearer header is parsed, and only when well formed', () => {
  const h = (v) => new Request('https://x/', { headers: v ? { authorization: v } : {} });
  assert.equal(bearer(h('Bearer abc')), 'abc');
  assert.equal(bearer(h('bearer abc')), null);
  assert.equal(bearer(h('Basic abc')), null);
  assert.equal(bearer(h(null)), null);
});

test('display names are bounded and stripped of control characters', () => {
  assert.equal(cleanName('  Brian  '), 'Brian');
  assert.equal(cleanName('a'.repeat(100)).length, 24);
  assert.equal(cleanName('Ada Lovelace'), 'Ada Lovelace', 'ordinary spaces survive');
  assert.equal(cleanName('bad\u0000\u200bname'), 'badname');
  assert.equal(cleanName(''), 'Dove');
  assert.equal(cleanName(null), 'Dove');
  assert.equal(cleanName('\u0000\u0001'), 'Dove');
  assert.equal(cleanName('   '), 'Dove', 'whitespace-only falls back');
});
