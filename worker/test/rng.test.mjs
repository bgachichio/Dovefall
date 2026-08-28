// The anchor test.
//
// If this fails, the server and the game no longer agree about physics, and
// every seed-derived claim the API makes is void. It is deliberately the first
// test in the suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, determinismCheck, GODOT_CHECKSUM, dailySeed, todayKey, seedCode, parseSeedCode } from '../src/rng.js';

test('determinism checksum matches the Godot build', () => {
  assert.equal(
    determinismCheck(),
    GODOT_CHECKSUM,
    'The JS port of Rng + the fixed-step integration no longer reproduces the ' +
      'checksum that Main.gd prints on device. Either Config constants drifted ' +
      'or the RNG port broke. Do not ship a leaderboard until this passes.',
  );
});

test('xorshift32 stays inside 32 bits and never returns to zero', () => {
  const rng = new Rng(0xd0fe);
  for (let i = 0; i < 10000; i++) {
    const v = rng.next();
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff, `out of range at ${i}: ${v}`);
    assert.notEqual(v, 0, 'xorshift32 collapsed to zero');
  }
});

test('a zero seed is coerced to one, as in GDScript', () => {
  const rng = new Rng(0);
  assert.equal(rng.currentSeed, 1);
});

test('the same seed replays the same stream', () => {
  const a = new Rng(12345);
  const b = new Rng(12345);
  for (let i = 0; i < 500; i++) assert.equal(a.next(), b.next());
});

test('randf01 stays in [0, 1)', () => {
  const rng = new Rng(99);
  for (let i = 0; i < 5000; i++) {
    const v = rng.randf01();
    assert.ok(v >= 0 && v < 1, `randf01 out of range: ${v}`);
  }
});

test('daily seed matches Rng.seed_daily arithmetic', () => {
  // seed_daily() = year * 10000 + month * 100 + day, UTC.
  assert.equal(dailySeed('2026-08-28'), 2026 * 10000 + 8 * 100 + 28);
  assert.equal(dailySeed('2026-01-01'), 20260101);
});

test('today key is UTC and ISO shaped', () => {
  assert.match(todayKey(new Date('2026-08-28T23:59:59Z')), /^2026-08-28$/);
  assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test('seed codes round-trip through the wire format', () => {
  for (const s of [1, 0xd0fe, 0xffffffff, 20260828]) {
    assert.equal(parseSeedCode(seedCode(s)), s >>> 0);
  }
});

test('malformed seed codes are rejected rather than coerced', () => {
  for (const bad of ['', 'ZZZZ', '1234567890', null, undefined, '0', 42]) {
    assert.equal(parseSeedCode(bad), null, `accepted a bad seed code: ${bad}`);
  }
});
