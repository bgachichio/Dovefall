// The engine, at the level that matters: does it produce the same flight
// everywhere, and is the playfield the same size for everybody?
//
// Node 22 strips TypeScript types on import, so these run the real modules the
// browser runs — not a copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, GODOT_CHECKSUM, dailySeed, seedCode } from '../src/engine/rng.ts';
import {
  createSim, step, queueFlap, spawn, replayBlob, continueRun, canRestart, die,
  VW, VH, doveW, doveH, curGap, gateW, bandFor, rampFor, chapterIndex,
} from '../src/engine/sim.ts';
import { MAX_STEPS_PER_FRAME } from '../src/engine/loop.ts';
import { gatePitch } from '../src/audio.ts';
import {
  FIXED, TERMINAL_MULT, MODES, CROSSFADE_S, RESTART_MS, SW_COUNTDOWN_S, SW_MIN_SCORE,
} from '../src/engine/constants.ts';

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

// ------------------------------------------------- parity with the Godot build
//
// These exist because the port lost each of them once. Every case below is a
// line of scripts/Game.gd or project.godot that the web build has to honour or
// the game stops feeling like the game.

test('a flap reports itself, so feedback can fire on the input event', () => {
  // Game.gd fired the sound and the buzz in _queue_flap(), not on the tick,
  // with a comment about the 8 ms it saves. The port routed it through the
  // per-tick event list, which step() clears before anyone reads it — so the
  // flap was silent. queueFlap now returns whether it took one.
  const s = createSim({ seed: 0xd0fe });
  assert.equal(queueFlap(s, 0), true, 'the first tap starts the run and flaps');
  assert.equal(s.phase, 'play');
  assert.equal(queueFlap(s, 0), true, 'and so does the next');

  s.phase = 'dead';
  assert.equal(queueFlap(s, 0), false, 'a dead dove does not flap');

  s.phase = 'play';
  s.countdown = 2;
  assert.equal(queueFlap(s, 0), false, 'nor does one waiting on a countdown');
});

test('the respawn countdown freezes the world, t included', () => {
  // Godot paused the whole tree during the countdown. `t` drives gate drift,
  // so letting it advance would move the gates while the player watches a
  // number count down — the one moment they are promised nothing changes.
  const s = createSim({ seed: 0xd0fe });
  queueFlap(s, 0);
  for (let i = 0; i < 400; i++) step(s, i * 8);
  continueRun(s);

  const before = { t: s.t, x: s.gates.map((g) => g.x), y: s.y };
  for (let i = 0; i < 60; i++) step(s, i);
  assert.equal(s.t, before.t, 't does not advance');
  assert.deepEqual(s.gates.map((g) => g.x), before.x, 'nothing moves');
  assert.equal(s.y, before.y, 'and the dove holds');
  assert.ok(s.countdown < SW_COUNTDOWN_S, 'but the countdown is running');
});

test('input is ignored for RESTART_MS after a death', () => {
  const s = createSim({ seed: 0xd0fe });
  s.diedAt = 1000;
  assert.equal(canRestart(s, 1000), false, 'the tap that killed you does not restart');
  assert.equal(canRestart(s, 1000 + RESTART_MS - 1), false);
  assert.equal(canRestart(s, 1000 + RESTART_MS), true);
});

test('the chapter cross-fade takes CROSSFADE_S, not a hard-coded number', () => {
  const s = createSim({ seed: 0xd0fe });
  s.palT = 0;
  queueFlap(s, 0);
  const ticks = Math.round(CROSSFADE_S / FIXED);
  for (let i = 0; i < ticks - 2; i++) step(s, i * 8);
  assert.ok(s.palT < 1, `still fading after ${ticks - 2} ticks`);
  step(s, 0);
  step(s, 0);
  step(s, 0);
  assert.equal(s.palT, 1, 'and complete at CROSSFADE_S');
});

test('catch-up is capped at the Godot project\'s twelve steps per frame', () => {
  // project.godot: physics/common/max_physics_steps_per_frame = 12. Returning
  // from a locked screen must not deliver a thousand ticks of world at once,
  // and must not deliver more than the Android build would have.
  assert.equal(MAX_STEPS_PER_FRAME, 12);
});

test('the gate tone climbs a semitone every five points', () => {
  // Game.gd: Sfx.play("gate", pow(1.0595, floori(score / 5))). Most of why a
  // long run feels like it is going somewhere.
  assert.equal(gatePitch(0), 1);
  assert.equal(gatePitch(4), 1);
  assert.ok(Math.abs(gatePitch(5) - 1.0595) < 1e-9);
  assert.ok(gatePitch(50) > gatePitch(25));
});

test('deaths carry across runs, or the second wind is never offered', () => {
  // Game.gd kept session_deaths on the Game node, which outlived a run. A
  // fresh Sim per run reset it to zero, and SW_MIN_SESSION_DEATHS could then
  // never be met from a first death — so the offer effectively vanished.
  const first = createSim({ seed: 1 });
  first.phase = 'play';
  first.score = SW_MIN_SCORE;
  die(first, 0);
  assert.equal(first.sessionDeaths, 1);
  assert.equal(first.swOffer, false, 'not on the first death of a sitting');

  const second = createSim({ seed: 2, sessionDeaths: first.sessionDeaths });
  second.phase = 'play';
  second.score = SW_MIN_SCORE;
  die(second, 0);
  assert.equal(second.swOffer, true, 'offered on the second');

  const lowScore = createSim({ seed: 3, sessionDeaths: 5 });
  lowScore.phase = 'play';
  lowScore.score = SW_MIN_SCORE - 1;
  die(lowScore, 0);
  assert.equal(lowScore.swOffer, false, 'and never below the score floor');
});
