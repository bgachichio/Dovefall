// Mirror of the game's autoload/Config.gd constants.
//
// These MUST stay in step with the Godot project. The guard against drift is
// test/rng.test.mjs, which recomputes Main.gd's _determinism_check() from the
// values below and asserts it equals 4075699207 — the checksum the runbook's
// Gate 9 requires on device. Change a number here (or there) and that test
// fails loudly instead of the leaderboard failing quietly.

export const FIXED = 1.0 / 120.0;
export const TERMINAL_MULT = 0.55;

/** Config.gd MODES */
export const MODES = {
  easy:   { grav: 2100.0, flap: 470.0, gap: 4.9, spd: 200.0, gsp: 260.0 },
  normal: { grav: 2625.0, flap: 510.0, gap: 4.0, spd: 260.0, gsp: 330.0 },
  hard:   { grav: 2900.0, flap: 530.0, gap: 3.6, spd: 300.0, gsp: 375.0 },
  pro:    { grav: 3200.0, flap: 545.0, gap: 3.2, spd: 330.0, gsp: 400.0 },
};

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
