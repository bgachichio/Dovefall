// Plausibility bounds, derived from the game's constants rather than guessed.
//
// Gates are spawned exactly `gsp` pixels apart and travel left at
// `spd * band.spd_x`. So the wall-clock time to reach any score is arithmetic,
// not opinion. A run claiming score 500 in sixty seconds is rejected because
// the world cannot physically have moved that far, whatever the client says.
//
// This is layer 2 of the anti-cheat design. It is cheap, it is exact, and it
// does not depend on replaying anything.

import { MODES, BANDS, bandFor, BASE_W, BIRD_X_FRAC, MAX_PLAUSIBLE_SCORE } from './config.js';

/**
 * How much slack we allow below the theoretical minimum, to absorb modelling
 * error (gate width, the exact pass plane, when run_started_ms is stamped).
 * Deliberately generous: this layer should reject only the impossible.
 */
export const TOLERANCE = 0.8;

/**
 * Distance the world travels before the first gate is passed. Conservative —
 * it ignores the +70 px spawn offset and the gate's own width, so the bound it
 * produces is looser than reality and cannot cause a false rejection.
 */
function firstGateDistance() {
  return BASE_W * (1 - BIRD_X_FRAC);
}

/** Theoretical minimum seconds to reach `score` in `mode`, before tolerance. */
export function minSecondsForScore(mode, score) {
  const m = MODES[mode];
  if (!m || score <= 0) return 0;

  let t = firstGateDistance() / (m.spd * bandFor(0).spd_x);
  for (let k = 1; k < score; k++) {
    t += m.gsp / (m.spd * bandFor(k).spd_x);
  }
  return t;
}

/** The bound actually enforced, in milliseconds. */
export function minDurationMs(mode, score) {
  return Math.floor(minSecondsForScore(mode, score) * TOLERANCE * 1000);
}

/**
 * Inverse, for a reject message a human can act on: the highest score the
 * claimed duration could possibly support.
 */
export function maxScoreForDuration(mode, durationMs) {
  let lo = 0;
  let hi = MAX_PLAUSIBLE_SCORE;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (minDurationMs(mode, mid) <= durationMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Validate a submitted run. Returns `null` when the run is plausible, or a
 * short machine-readable reason when it is not.
 *
 * Deliberately NOT a replay check. Replay validation needs the physics port to
 * be proven against golden vectors from a real Godot build first — see
 * godot/tools/golden_vectors.gd. Until then this is the honest ceiling of what
 * the server can assert, and the replay log is stored so that historical runs
 * become checkable the day the validator lands.
 */
export function checkRun({ mode, score, durationMs, secondWindUsed, assistActive, respawnUsed }) {
  if (!MODES[mode]) return 'bad_mode';
  if (!Number.isInteger(score) || score < 0 || score > MAX_PLAUSIBLE_SCORE) return 'bad_score';
  if (!Number.isInteger(durationMs) || durationMs < 0) return 'bad_duration';

  // A run continued by watching an advert does not share a table with one that
  // was not. Game.gd already reports this; we simply hold it to it.
  if (secondWindUsed) return 'second_wind';

  // Dynamic assistance widens the gap, so an assisted run is a different course.
  if (assistActive) return 'assisted';

  // A paid respawn continues the run past a death, same as Second Wind: the
  // player bought a longer session and more feathers, never a rank.
  if (respawnUsed) return 'continued';

  if (score > 0 && durationMs < minDurationMs(mode, score)) return 'too_fast';

  return null;
}

export const REASONS = {
  bad_mode: 'Unknown difficulty.',
  bad_score: 'Score out of range.',
  bad_duration: 'Duration out of range.',
  second_wind: 'Runs that used Second Wind are not ranked.',
  continued: 'Runs continued with a respawn are not ranked.',
  assisted: 'Runs with assistance active are not ranked.',
  too_fast: 'Score is higher than the run duration allows.',
};

export { BANDS };
