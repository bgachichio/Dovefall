// Mirror of the game's autoload/Config.gd constants.
//
// These MUST stay in step with the Godot project. The guard against drift is
// test/rng.test.mjs, which recomputes Main.gd's _determinism_check() from the
// values below and asserts it equals 4074801275 — the checksum the runbook's
// Gate 9 requires on device. Change a number here (or there) and that test
// fails loudly instead of the leaderboard failing quietly.

export const FIXED = 1.0 / 120.0;
export const TERMINAL_MULT = 0.55;

/**
 * The game's MODES, mirrored from game/src/engine/constants.ts.
 *
 * The glide retune of 2026-09 scaled gravity by 0.85, the flap impulse by
 * sqrt(0.85), and spd and gsp together by 1.04. Only the last two reach this
 * file's arithmetic: the bounds below turn on how long the world takes to carry
 * a gate to the dove, which is gsp/spd — deliberately unchanged, so a score
 * submitted before the retune and one submitted after are still the same
 * achievement, and no old run became retrospectively impossible.
 *
 * `kids` is NOT here. It is a local, unranked mode; a run in it is never
 * submitted, and a submission naming it is refused by isMode below.
 */
export const MODES = {
  easy:   { grav: 1785.0, flap: 433.3, gap: 4.9, spd: 208.0, gsp: 270.4 },
  normal: { grav: 2231.3, flap: 470.2, gap: 4.0, spd: 270.4, gsp: 343.2 },
  hard:   { grav: 2465.0, flap: 488.6, gap: 3.6, spd: 312.0, gsp: 390.0 },
  pro:    { grav: 2720.0, flap: 502.5, gap: 3.2, spd: 343.2, gsp: 416.0 },
};

/** The ranked ladder. Every mode with a leaderboard, and no others. */
export const MODE_ORDER = ['easy', 'normal', 'hard', 'pro'];

/** Config.gd BANDS — a band boundary changes gap and speed and nothing else. */
export const BANDS = [
  { from: 0,  gap_x: 1.167, spd_x: 1.00 },
  { from: 5,  gap_x: 1.000, spd_x: 1.00 },
  { from: 15, gap_x: 0.889, spd_x: 1.10 },
  { from: 30, gap_x: 0.833, spd_x: 1.20 },
  { from: 50, gap_x: 0.806, spd_x: 1.25 },
];

/**
 * Design viewport from project.godot. With stretch/aspect="keep" this is the
 * viewport on every device, not merely the design target — which is what makes
 * the bounds below the same arithmetic everywhere.
 */
export const BASE_W = 1080;

/** Bird's horizontal station, as a fraction of viewport width (Game.gd). */
export const BIRD_X_FRAC = 0.26;

/** Highest score we will accept at all. Guards against integer nonsense. */
export const MAX_PLAUSIBLE_SCORE = 10000;

export function bandFor(score) {
  let r = BANDS[0];
  for (const b of BANDS) if (score >= b.from) r = b;
  return r;
}

export function isMode(m) {
  return Object.prototype.hasOwnProperty.call(MODES, m);
}
