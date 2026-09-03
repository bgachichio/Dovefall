// The engine, at the level that matters: does it produce the same flight
// everywhere, and is the playfield the same size for everybody?
//
// Node 22 strips TypeScript types on import, so these run the real modules the
// browser runs — not a copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, GODOT_CHECKSUM, dailySeed, seedCode } from '../src/engine/rng.ts';
import {
  createSim, step, queueFlap, spawn, replayBlob, continueRun,
  VW, VH, doveW, doveH, curGap, gateW, bandFor, rampFor, chapterIndex,
} from '../src/engine/sim.ts';
import { FIXED, TERMINAL_MULT, MODES } from '../src/engine/constants.ts';

// ------------------------------------------------------------------ the anchor
test('the RNG still reproduces the Godot checksum', () => {
  // Main.gd _determinism_check(), transcribed. If this moves, the web build and
  // the Android build are no longer the same game and the board is meaningless.
  const rng = new Rng(0xd0fe);
  const m = MODES.normal;
  let y = 0, v = 0, acc = 0;
  for (let i = 0; i < 600; i++) {
    if (i % 37 === 0) v = -m.flap;
    v = Math.min(v + m.grav * FIXED, m.grav * TERMINAL_MULT);
    y += v * FIXED;
    acc = (acc + rng.next()) % 4294967296;
  }
  assert.equal((Math.trunc(Math.abs(y) * 1000) ^ acc) >>> 0, GODOT_CHECKSUM);
});

test('a zero seed is coerced, exactly as in GDScript', () => {
  assert.equal(new Rng(0).currentSeed, 1);
  assert.equal(seedCode(0xd0fe), 'D0FE');
});

test('the daily seed is the same number for everyone on a given UTC day', () => {
  assert.equal(dailySeed('2026-09-03'), dailySeed('2026-09-03'));
  assert.notEqual(dailySeed('2026-09-03'), dailySeed('2026-09-04'));
});

// ------------------------------------------------------------------ fairness
test('the playfield is a constant — this is the whole leaderboard argument', () => {
  assert.equal(VW, 1080);
  assert.equal(VH, 1920);
  assert.equal(doveW(), 336);
  assert.equal(doveH(), 210);
  assert.equal(gateW(), 135);

  // Band I opens wider on purpose — the first five gates are the tutorial the
  // game gives every player whether they asked for one or not.
  const s = createSim({ seed: 0xd0fe });
  assert.equal(s.score, 0);
  assert.equal(Math.round(curGap(s)), 980, 'normal, band I');

  s.score = 5;
  assert.equal(curGap(s), 840, 'normal, band II — the number the docs quote');
  const band = (VH * 0.74 - curGap(s)) - VH * 0.09;
  assert.equal(Math.round(band), 408, 'the placement band');

  s.score = 50;
  assert.ok(curGap(s) < 840, 'and it keeps tightening');
});

test('the same seed gives the same first three gates, every time', () => {
  const tops = () => createSim({ seed: 0xd0fe }).gates.map((g) => g.top);
  const a = tops();
  const b = tops();
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  // And a different seed gives a different course, or the seed does nothing.
  assert.notDeepEqual(a, createSim({ seed: 0x1234 }).gates.map((g) => g.top));
});

test('every gate is placed inside the legal band', () => {
  for (const seed of [1, 0xd0fe, 0xffffffff, 12345]) {
    const s = createSim({ seed });
    for (let i = 0; i < 400; i++) spawn(s, 2000);
    for (const g of s.gates) {
      assert.ok(g.top >= VH * 0.09 - 1, `top ${g.top} above the ceiling`);
      assert.ok(g.top + g.gap <= VH * 0.74 + 1, `bottom ${g.top + g.gap} below the floor`);
    }
  }
});

// ------------------------------------------------------------------ tables
test('the difficulty tables step where they are supposed to', () => {
  assert.equal(bandFor(0).name, 'I');
  assert.equal(bandFor(5).name, 'II');
  assert.equal(bandFor(14).name, 'II');
  assert.equal(bandFor(15).name, 'III');
  assert.equal(bandFor(999).name, 'V');
  assert.equal(rampFor(0).dens, 0);
  assert.equal(rampFor(12).ground, true);
  assert.equal(rampFor(20).air, true);
  assert.equal(rampFor(35).drift, true);
  assert.equal(chapterIndex(0), 0);
  assert.equal(chapterIndex(5), 1);
  assert.equal(chapterIndex(15), 2);
  assert.equal(chapterIndex(30), 3);
});

test('a harder mode is harder in every direction', () => {
  const easy = MODES.easy;
  const pro = MODES.pro;
  assert.ok(pro.gap < easy.gap, 'tighter gap');
  assert.ok(pro.spd > easy.spd, 'faster');
  assert.ok(pro.coy < easy.coy, 'less forgiveness');
  assert.ok(pro.hit >= easy.hit, 'a bigger hitbox');
});

// ------------------------------------------------------------------ the run
test('a dove left alone falls, hits the floor and dies', () => {
  const s = createSim({ seed: 0xd0fe });
  queueFlap(s, 0);
  assert.equal(s.phase, 'play');
  for (let i = 0; i < 2000 && s.phase === 'play'; i++) step(s, i * 8);
  assert.equal(s.phase, 'dead');
  assert.equal(s.deathCause, 'floor');
  assert.equal(s.score, 0);
});

test('a flap arrests the fall on the very next tick', () => {
  const s = createSim({ seed: 0xd0fe });
  queueFlap(s, 0);
  for (let i = 0; i < 40; i++) step(s, i);
  const falling = s.vy;
  assert.ok(falling > 0, 'gravity is working');
  queueFlap(s, 0);
  step(s, 0);
  assert.ok(s.vy < 0, 'and the tap reverses it immediately');
  assert.equal(s.vy, -MODES.normal.flap + MODES.normal.grav * FIXED);
});

test('an autopilot can score, and the same seed scores the same', () => {
  // Fly to the middle of the next gap. Not clever, just deterministic.
  function play(seed) {
    const s = createSim({ seed });
    queueFlap(s, 0);
    for (let i = 0; i < 40_000 && s.phase === 'play'; i++) {
      const next = s.gates.find((g) => !g.passed);
      if (next) {
        const target = next.top + next.gap * 0.5;
        if (s.y > target && s.vy > -80) queueFlap(s, i);
      }
      step(s, i * 8);
    }
    return { score: s.score, ticks: s.tick, blob: replayBlob(s) };
  }
  const a = play(0xd0fe);
  assert.ok(a.score > 5, `autopilot scored ${a.score}`);
  assert.deepEqual(play(0xd0fe), a, 'identical replay from an identical seed');
});

test('the replay blob is the flap ticks, and it is small', () => {
  const s = createSim({ seed: 0xd0fe });
  queueFlap(s, 0);
  for (let i = 0; i < 1200 && s.phase === 'play'; i++) {
    if (i % 24 === 0) queueFlap(s, i);
    step(s, i * 8);
  }
  const blob = replayBlob(s);
  assert.ok(blob.length > 0);
  assert.ok(blob.length < s.flapTicks.length * 3, 'delta-encoded, not one byte per tick');
  assert.match(blob, /^[A-Za-z0-9+/]+={0,2}$/);
});

test('continuing clears the sky ahead, or the player pays and dies to the same gate', () => {
  const s = createSim({ seed: 0xd0fe });
  queueFlap(s, 0);
  for (let i = 0; i < 3000 && s.phase === 'play'; i++) step(s, i * 8);
  assert.equal(s.phase, 'dead');

  continueRun(s);
  assert.equal(s.phase, 'play');
  assert.ok(s.invuln > 0, 'and a moment of invulnerability');
  assert.ok(s.countdown > 0, 'and a countdown before the world moves');
  const clearTo = VW * 0.26 + doveW() * 2.6;
  for (const g of s.gates) {
    assert.ok(g.x >= clearTo || g.passed, 'nothing unpassed is still in the way');
  }
});

test('a run that is continued is marked, so it can never be ranked', () => {
  const s = createSim({ seed: 1 });
  assert.equal(s.respawnUsed, false);
  continueRun(s);
  assert.equal(s.respawnUsed, true);
});

test('atmosphere never touches the seeded stream', () => {
  // Turning particles down for battery must not change the course.
  const full = createSim({ seed: 0xd0fe, atmos: 2 }).gates.map((g) => g.top);
  const none = createSim({ seed: 0xd0fe, atmos: 0 }).gates.map((g) => g.top);
  assert.deepEqual(none, full);
});
