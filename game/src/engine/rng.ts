// Deterministic xorshift32 — the same stream as the Godot build's Rng.gd and
// the server's worker/src/rng.js.
//
// All three have to agree or nothing else works: the client generates a course
// from a seed, the server re-derives the same course to check the score, and
// the daily challenge is the same flight for everybody. test/engine.test.mjs
// asserts the checksum below, exactly as the worker's suite does.

export class Rng {
  state = 1;
  currentSeed = 1;

  constructor(seed = 1) {
    this.seedRun(seed);
  }

  /** A zero seed is coerced to 1, exactly as in GDScript. */
  seedRun(s: number): number {
    s = s >>> 0;
    if (s === 0) s = 1;
    this.state = s;
    this.currentSeed = s;
    return s;
  }

  /** GDScript masks to 32 bits after each shift; `>>> 0` is that operation. */
  next(): number {
    let s = this.state;
    s = (s ^ ((s << 13) >>> 0)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ ((s << 5) >>> 0)) >>> 0;
    this.state = s;
    return s;
  }

  randf01(): number {
    return this.next() / 4294967296.0;
  }

  rangeF(a: number, b: number): number {
    return a + (b - a) * this.randf01();
  }

  chance(p: number): boolean {
    return this.randf01() < p;
  }
}

/** The uppercase hex the client shows and submits with a run. */
export function seedCode(seed: number): string {
  return (seed >>> 0).toString(16).toUpperCase();
}

/** UTC day key. The daily challenge rolls at midnight UTC for everyone. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dailySeed(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  const s = (y * 10000 + m * 100 + d) >>> 0;
  return s === 0 ? 1 : s;
}

/** A fresh random seed for a normal run. */
export function randomSeed(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] === 0 ? 1 : b[0];
}

export const GODOT_CHECKSUM = 4075699207;
