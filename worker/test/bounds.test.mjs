import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minSecondsForScore, minDurationMs, maxScoreForDuration, checkRun } from '../src/bounds.js';
import { MODE_ORDER } from '../src/config.js';

test('minimum time rises with score, in every mode', () => {
  for (const mode of MODE_ORDER) {
    let prev = -1;
    for (let score = 0; score <= 120; score++) {
      const t = minSecondsForScore(mode, score);
      assert.ok(t > prev, `${mode}: score ${score} was not slower than ${score - 1}`);
      prev = t;
    }
  }
});

test('harder modes are faster, so their bounds are tighter', () => {
  // pro moves the world fastest, so a given score is reachable soonest there.
  const at50 = MODE_ORDER.map((m) => minSecondsForScore(m, 50));
  for (let i = 1; i < at50.length; i++) {
    assert.ok(at50[i] < at50[i - 1], `${MODE_ORDER[i]} should reach 50 sooner than ${MODE_ORDER[i - 1]}`);
  }
});

test('a plausible run is accepted', () => {
  // ~60 s for 50 gates on normal is comfortably above the floor.
  assert.equal(checkRun({ mode: 'normal', score: 50, durationMs: 60_000 }), null);
  assert.equal(checkRun({ mode: 'normal', score: 0, durationMs: 900 }), null);
});

test('an impossible run is rejected', () => {
  assert.equal(checkRun({ mode: 'normal', score: 500, durationMs: 60_000 }), 'too_fast');
  assert.equal(checkRun({ mode: 'pro', score: 100, durationMs: 1_000 }), 'too_fast');
});

test('the bound sits below the honest minimum, so real runs survive it', () => {
  for (const mode of MODE_ORDER) {
    for (const score of [1, 5, 15, 30, 50, 100]) {
      const honest = minSecondsForScore(mode, score) * 1000;
      assert.ok(
        minDurationMs(mode, score) < honest,
        `${mode}/${score}: enforced bound is not below the theoretical minimum`,
      );
    }
  }
});

test('maxScoreForDuration inverts minDurationMs', () => {
  for (const mode of MODE_ORDER) {
    for (const score of [1, 7, 23, 60]) {
      const ms = minDurationMs(mode, score);
      const back = maxScoreForDuration(mode, ms);
      assert.ok(back >= score, `${mode}/${score}: inverse gave ${back}`);
      assert.equal(checkRun({ mode, score: back + 1, durationMs: ms }), 'too_fast');
    }
  }
});

test('Second Wind and assisted runs are unranked', () => {
  assert.equal(checkRun({ mode: 'normal', score: 20, durationMs: 60_000, secondWindUsed: true }), 'second_wind');
  assert.equal(checkRun({ mode: 'normal', score: 20, durationMs: 60_000, assistActive: true }), 'assisted');
});

test('malformed submissions are rejected before any arithmetic', () => {
  assert.equal(checkRun({ mode: 'nope', score: 1, durationMs: 1 }), 'bad_mode');
  assert.equal(checkRun({ mode: 'normal', score: -1, durationMs: 1 }), 'bad_score');
  assert.equal(checkRun({ mode: 'normal', score: 1.5, durationMs: 1 }), 'bad_score');
  assert.equal(checkRun({ mode: 'normal', score: 1e9, durationMs: 1 }), 'bad_score');
  assert.equal(checkRun({ mode: 'normal', score: 1, durationMs: -5 }), 'bad_duration');
  assert.equal(checkRun({ mode: 'normal', score: 1, durationMs: NaN }), 'bad_duration');
});
