// Port of the game's autoload/Rng.gd — deterministic xorshift32.
//
// Verified against Godot: reproducing Main.gd's _determinism_check() with this
// implementation yields 4075699207, the value the runbook's Gate 9 requires the
// device and the desktop to agree on. That match is what licenses the server to
// reason about seeds at all.

import { FIXED, TERMINAL_MULT, MODES } from './config.js';

export class Rng {
  constructor(seed = 1) {
    this.seedRun(seed);
  }

  /** Rng.seed_run() — a zero seed is coerced to 1, exactly as in GDScript. */
  seedRun(s) {
    s = s >>> 0;
    if (s === 0) s = 1;
    this.state = s;
    this.currentSeed = s;
    return s;
  }

  /**
   * Rng.next(). GDScript masks to 32 bits after each shift; `>>> 0` is the
   * same operation. `>>> 17` is the logical shift GDScript performs on a
   * value it knows to be non-negative.
   */
  next() {
    let s = this.state;
    s = (s ^ ((s << 13) >>> 0)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ ((s << 5) >>> 0)) >>> 0;
    this.state = s;
    return s;
  }

  randf01() {
    return this.next() / 4294967296.0;
  }

  rangeF(a, b) {
    return a + (b - a) * this.randf01();
  }

  chance(p) {
    return this.randf01() < p;
  }
}

/** Rng.seed_code() — the uppercase hex the client shows and submits. */
export function seedCode(seed) {
  return (seed >>> 0).toString(16).toUpperCase();
}

export function parseSeedCode(code) {
  if (typeof code !== 'string' || !/^[0-9A-Fa-f]{1,8}$/.test(code)) return null;
  const n = parseInt(code, 16) >>> 0;
  return n === 0 ? null : n;
}

/** Rng.today_key() — UTC, YYYY-MM-DD. */
export function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Rng.seed_daily() — every player flies the identical course for the whole
 * calendar day. The server derives this independently so it can tell whether a
 * submitted daily run used the real seed.
 */
export function dailySeed(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const s = (y * 10000 + m * 100 + d) >>> 0;
  return s === 0 ? 1 : s;
}

/**
 * Port of Main.gd _determinism_check(). Not used at request time — it exists so
 * the test suite can prove this file still agrees with the engine.
 */
export function determinismCheck() {
  const rng = new Rng(0xd0fe);
  const m = MODES.normal;
  let y = 0.0;
  let v = 0.0;
  let acc = 0;
  for (let i = 0; i < 600; i++) {
    if (i % 37 === 0) v = -m.flap;
    v = Math.min(v + m.grav * FIXED, m.grav * TERMINAL_MULT);
    y += v * FIXED;
    acc = (acc + rng.next()) % 4294967296;
  }
  return (Math.trunc(Math.abs(y) * 1000.0) ^ acc) >>> 0;
}

export const GODOT_CHECKSUM = 4075699207;
