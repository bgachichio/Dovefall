// What the glide retune promised, held to.
//
// Three numbers changed how the dove feels, and every one of them could have
// changed how hard the game is without anybody noticing until the leaderboard
// stopped meaning anything. So the invariants are written down here as
// arithmetic against the tuning Dovefall shipped with on Android, and the
// tuning has to keep clearing them.
//
// GODOT is that original tuning. It is a fixed historical record — never
// update it to match a change. If a change moves one of these, that is the
// test telling you the change is a difficulty change, and it wants saying out
// loud rather than editing away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES, MODE_ORDER, RANKED_MODES, BANDS, RAMP, DOVE_W, DOVE_H, DOVE_FRAMES, DOVE_DIVISOR,
} from '../src/engine/constants.ts';
import { createSim, spawn, step, curGap, curSpd, hitbox, doveH, isKids, VH } from '../src/engine/sim.ts';

/** autoload/Config.gd, as it stood before 2026-09-09. */
const GODOT = {
  easy:   { grav: 2100.0, flap: 470.0, gap: 4.9, spd: 200.0, gsp: 260.0, hit: 0.82 },
  normal: { grav: 2625.0, flap: 510.0, gap: 4.0, spd: 260.0, gsp: 330.0, hit: 0.91 },
  hard:   { grav: 2900.0, flap: 530.0, gap: 3.6, spd: 300.0, gsp: 375.0, hit: 0.95 },
  pro:    { grav: 3200.0, flap: 545.0, gap: 3.2, spd: 330.0, gsp: 400.0, hit: 1.00 },
};
const GODOT_DOVE_H = 10;
const px = Math.max(2, Math.round(1080 / DOVE_DIVISOR));

const close = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tolerance ${tol})`);

// ------------------------------------------------------- what must not move

test('one tap still buys exactly the same height', () => {
  // The apex above the point of the tap is flap^2 / 2*grav. This is the number
  // a player's hands learn, and it is why grav scaled by k while flap scaled by
  // sqrt(k) rather than by k.
  for (const [mode, old] of Object.entries(GODOT)) {
    const now = MODES[mode];
    close(
      now.flap ** 2 / (2 * now.grav),
      old.flap ** 2 / (2 * old.grav),
      0.02,
      `${mode}: apex per tap`,
    );
  }
});

test('gates still arrive at exactly the same rate', () => {
  // Seconds between gates is gsp/spd. Hold it and a score is worth the same
  // number of seconds it always was — which is what lets the pre-retune board
  // and the post-retune board sit in the same table honestly, and what lets
  // worker/src/bounds.js keep its arithmetic.
  for (const [mode, old] of Object.entries(GODOT)) {
    close(MODES[mode].gsp / MODES[mode].spd, old.gsp / old.spd, 1e-9, `${mode}: gate cadence`);
  }
});

test('the hole is still the same hole, in pixels', () => {
  // The dove lost a fifth of its height, and the gap is measured in
  // dove-heights, so the gap constant had to grow to keep the clearance —
  // gap in px minus the hitbox in px — where it was.
  for (const [mode, old] of Object.entries(GODOT)) {
    const now = MODES[mode];
    const before = GODOT_DOVE_H * px * old.gap - GODOT_DOVE_H * px * old.hit;
    const after = DOVE_H * px * now.gap - DOVE_H * px * now.hit;
    close(after, before, 0.2, `${mode}: vertical clearance`);
  }
});

test('the hitbox stays inside the drawn bird', () => {
  // A collision box larger than the sprite kills a player who can see daylight.
  // hit is a fraction of the sprite, so this holds as long as no mode has
  // hit > 1 — pro sits exactly on the boundary, deliberately.
  for (const mode of MODE_ORDER) {
    assert.ok(MODES[mode].hit <= 1.0, `${mode}: hitbox is bigger than the dove`);
  }
  const s = createSim({ mode: 'normal', seed: 1 });
  const b = hitbox(s);
  assert.ok(b.h <= doveH() + 0.001, 'hitbox is taller than the sprite');
});

// --------------------------------------------------------------- the glide

test('the arc is longer than it was, which is the whole point', () => {
  for (const [mode, old] of Object.entries(GODOT)) {
    const now = MODES[mode];
    const before = old.flap / old.grav;      // seconds from tap to apex
    const after = now.flap / now.grav;
    assert.ok(after > before * 1.05, `${mode}: the flap is not appreciably softer`);
    assert.ok(after < before * 1.15, `${mode}: the flap has gone floaty`);
  }
});

test('the world moved 4% brisker, no more', () => {
  for (const [mode, old] of Object.entries(GODOT)) {
    const r = MODES[mode].spd / old.spd;
    assert.ok(r >= 1.03 && r <= 1.05, `${mode}: scroll speed moved ${((r - 1) * 100).toFixed(1)}%`);
  }
});

test('terminal velocity fell with gravity, so the drop is gentler too', () => {
  for (const [mode, old] of Object.entries(GODOT)) {
    assert.ok(MODES[mode].grav < old.grav * 0.9, `${mode}: gravity did not soften`);
  }
});

// ------------------------------------------------------------------- art

test('every dove frame fills the sprite grid exactly', () => {
  assert.equal(DOVE_FRAMES.length, 4);
  for (const [i, frame] of DOVE_FRAMES.entries()) {
    assert.equal(frame.length, DOVE_H, `frame ${i} is not DOVE_H rows tall`);
    for (const row of frame) {
      assert.equal(row.length, DOVE_W, `frame ${i} has a row that is not DOVE_W wide`);
    }
  }
});

test('the wing carries about a tenth more of the bird than it did', () => {
  // Wing pixels under the Godot art, frame by frame.
  const BEFORE = [20, 17, 17, 19];
  const now = DOVE_FRAMES.map((f) => f.join('').split('').filter((c) => c === 'G').length);
  const grew = now.reduce((a, b) => a + b, 0) / BEFORE.reduce((a, b) => a + b, 0);
  assert.ok(grew >= 1.08, `wings grew only ${((grew - 1) * 100).toFixed(0)}%`);
  for (const [i, n] of now.entries()) {
    assert.ok(n >= BEFORE[i], `frame ${i}'s wing shrank`);
  }
});

test('the dove is visibly shorter and no wider', () => {
  assert.ok(DOVE_H < GODOT_DOVE_H, 'the dove is not shorter');
  assert.equal(DOVE_W, 16, 'the dove got narrower, which was not the ask');
  close(DOVE_H / GODOT_DOVE_H, 0.8, 0.001, 'height reduction');
});

// ------------------------------------------------------------------ kids

test('kids mode is not on the ladder', () => {
  assert.ok(MODE_ORDER.includes('kids'));
  assert.ok(!RANKED_MODES.includes('kids'), 'kids mode must never carry a leaderboard');
  assert.ok(isKids('kids'));
  assert.ok(!isKids('easy'));
});

test('kids mode never speeds up and never narrows', () => {
  // BANDS tighten the gap and quicken the world from score 15 onwards. A child
  // is not playing for the ramp; they are playing to make the bird go up.
  const kid = createSim({ mode: 'kids', seed: 7 });
  const gap0 = curGap(kid);
  const spd0 = curSpd(kid);
  kid.score = 80;
  assert.equal(curGap(kid), gap0, 'the kids gap narrowed with the score');
  assert.equal(curSpd(kid), spd0, 'the kids world sped up with the score');

  // …while a ranked mode still does both.
  const grown = createSim({ mode: 'normal', seed: 7 });
  const before = curGap(grown);
  grown.score = 80;
  assert.ok(curGap(grown) < before, 'normal stopped ramping, which is a regression');
});

test('kids mode spawns no hazards at any score', () => {
  const kid = createSim({ mode: 'kids', seed: 99 });
  for (let score = 0; score <= 120; score += 1) {
    kid.score = score;
    for (let i = 0; i < 20; i++) spawn(kid, 2000 + i * 300);
  }
  assert.equal(kid.hz.length, 0, 'a spike or a floater reached kids mode');
  assert.ok(kid.gates.every((g) => g.drift === 0), 'a kids gate drifted');

  // The same loop in normal mode must produce plenty of them, or this test is
  // asserting nothing at all.
  const grown = createSim({ mode: 'normal', seed: 99 });
  for (let score = 0; score <= 120; score += 1) {
    grown.score = score;
    for (let i = 0; i < 20; i++) spawn(grown, 2000 + i * 300);
  }
  assert.ok(grown.hz.length > 50, 'normal mode stopped spawning hazards');
});

test('kids mode still flies — the gap is wide but reachable', () => {
  // A gap wider than the playfield would mean a bird that cannot fall out of
  // it, which is not a game. It has to fit, with the sky above and below it.
  const kid = createSim({ mode: 'kids', seed: 3 });
  assert.ok(curGap(kid) < VH * 0.6, 'the kids gap swallowed the screen');
  assert.ok(curGap(kid) > doveH() * 3, 'the kids gap is not generous at all');

  // And a run in it advances like any other.
  let now = 0;
  for (let i = 0; i < 240; i++) { now += 1000 / 120; step(kid, now); }
  assert.equal(kid.phase, 'ready', 'a kids run started itself without a tap');
});

test('every mode in the picker exists in the tuning table', () => {
  for (const m of MODE_ORDER) assert.ok(MODES[m], `${m} is offered but has no tuning`);
  for (const m of RANKED_MODES) assert.ok(MODE_ORDER.includes(m), `${m} is ranked but not offered`);
  assert.equal(BANDS[0].from, 0);
  assert.equal(RAMP[0].from, 0);
});
