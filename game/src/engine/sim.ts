// The simulation. No canvas, no DOM, no React — just numbers advancing on a
// fixed 120 Hz tick, exactly as scripts/Game.gd did.
//
// THE INVARIANT THIS FILE EXISTS TO HOLD
//
// The world is 1080 x 1920. Always. On every phone, in every browser, at every
// zoom level. The canvas is scaled to fit the screen and letterboxed, so a big
// phone shows a bigger PICTURE of the same PLAYFIELD. That is what makes the
// leaderboard mean anything: the dove is 336 px wide, the gap is 840 px and the
// placement band is 408 px for everyone.
//
// The other half of the guarantee is the tick. Physics integrates on the
// constant FIXED (1/120 s), never on frame delta, so a 60 Hz phone and a 120 Hz
// phone fly the identical course from the same seed. Frame rate changes how
// smooth it looks and nothing else.

import {
  FIXED, TERMINAL_MULT, MODES, BANDS, RAMP, CHAPTERS,
  DOVE_W, DOVE_H, DOVE_DIVISOR, LANDMARK_GAP, PARTICLES,
  SW_MIN_SCORE, SW_MIN_SESSION_DEATHS, SW_CLEAR_AHEAD, SW_INVULN_S, SW_COUNTDOWN_S,
  CROSSFADE_S, RESTART_MS,
} from './constants.ts';
import { Rng } from './rng.ts';

export const VW = 1080;
export const VH = 1920;
export const GROUND = 0.88;      // Game.gd — floor line as a fraction of VH
const TAU = Math.PI * 2;

export type ModeId = 'easy' | 'normal' | 'hard' | 'pro';

/** One row of Config.MODES. Widened from the generated literal type so a Sim
 *  can hold any of the four without TypeScript pinning it to "normal". */
export interface Mode {
  grav: number; flap: number; gap: number; spd: number;
  gsp: number; hit: number; coy: number;
}
export type Phase = 'ready' | 'play' | 'dead';
export type DeathCause = 'gate' | 'floor' | 'ground_hazard' | 'air_hazard';

export interface Gate {
  x: number; top: number; base: number; gap: number;
  passed: boolean; drift: number; ph: number;
}
export interface Hazard {
  k: 'g' | 'a'; x: number; y: number; w: number; h: number;
  y0?: number; amp?: number; ph?: number; vx: number;
}
export interface Particle { x: number; y: number; z: number; vx: number; vy: number; len: number; r: number; }
export interface Prop { x: number; ci: number; }

export interface Sim {
  mode: ModeId;
  m: Mode;
  rng: Rng;
  seed: number;
  daily: boolean;
  tutorial: boolean;

  phase: Phase;
  t: number;
  tick: number;
  score: number;
  feathers: number;

  y: number; vy: number; rot: number; dist: number;
  sinceFlap: number; grace: number; invuln: number; flash: number;

  gates: Gate[]; hz: Hazard[]; props: Prop[]; parts: Particle[];
  lastTop: number | null; nextProp: number;

  palFrom: number; palTo: number; palT: number;

  respawnUsed: boolean;
  tutRespawns: number;
  swUsed: boolean; swOffer: boolean; sessionDeaths: number;
  deathCause: DeathCause;
  countdown: number;
  assist: number;
  atmos: 0 | 1 | 2;

  flapQueued: boolean;
  flapTicks: number[];
  startedAt: number;
  diedAt: number;
  /** Set for one tick when something happened worth a sound or a buzz. */
  events: string[];
}

// ------------------------------------------------------------------ tables
export const bandFor = (score: number) =>
  BANDS.reduce((r, b) => (score >= b.from ? b : r), BANDS[0]);
export const rampFor = (score: number) =>
  RAMP.reduce((r, x) => (score >= x.from ? x : r), RAMP[0]);
export const chapterIndex = (score: number) =>
  CHAPTERS.reduce((r, c, i) => (score >= c.from ? i : r), 0);

// ------------------------------------------------------------ derived sizes
export const dsize = () => Math.max(2, Math.round(VW / DOVE_DIVISOR));
export const doveW = () => DOVE_W * dsize();
export const doveH = () => DOVE_H * dsize();
export const gateW = () => Math.max(24, VW * 0.125);

export const curGap = (s: Sim) =>
  doveH() * s.m.gap * bandFor(s.score).gap_x * (1 + s.assist);
export const curSpd = (s: Sim) => s.m.spd * bandFor(s.score).spd_x;

// ------------------------------------------------------------------ create
export interface SimOptions {
  mode?: ModeId;
  seed: number;
  daily?: boolean;
  tutorial?: boolean;
  atmos?: 0 | 1 | 2;
  assist?: number;
  /**
   * Deaths so far in this SESSION, not this run. Game.gd kept it on the Game
   * node, which outlived a run, so the second wind was offered from your
   * second death of the sitting onwards. A fresh Sim per run resets it to
   * zero, and the offer would then almost never appear.
   */
  sessionDeaths?: number;
  now?: number;
}

export function createSim(o: SimOptions): Sim {
  const mode = o.mode ?? 'normal';
  const s: Sim = {
    mode,
    m: MODES[mode] as Mode,
    rng: new Rng(o.seed),
    seed: o.seed >>> 0,
    daily: Boolean(o.daily),
    tutorial: Boolean(o.tutorial),
    phase: 'ready',
    t: 0, tick: 0, score: 0, feathers: 0,
    y: VH * 0.42, vy: 0, rot: 0, dist: 0,
    sinceFlap: 0, grace: 0, invuln: 0, flash: 0,
    gates: [], hz: [], props: [], parts: [],
    lastTop: null, nextProp: 900,
    palFrom: 0, palTo: 0, palT: 1,
    respawnUsed: false,
    tutRespawns: o.tutorial ? 1 : 0,
    swUsed: false, swOffer: false, sessionDeaths: o.sessionDeaths ?? 0,
    deathCause: 'gate',
    countdown: 0,
    assist: o.assist ?? 0,
    atmos: o.atmos ?? 2,
    flapQueued: false, flapTicks: [],
    startedAt: 0, diedAt: 0,
    events: [],
  };
  initParticles(s);
  spawn(s, VW + 70);
  spawn(s, VW + 70 + s.m.gsp);
  spawn(s, VW + 70 + s.m.gsp * 2);
  return s;
}

// ------------------------------------------------------------------ spawn
export function spawn(s: Sim, atX: number): void {
  const r = rampFor(s.score);
  const g = curGap(s);
  const lo0 = VH * 0.09;
  let hi0 = VH * 0.74 - g;
  if (hi0 < lo0) hi0 = lo0;
  const mid = (lo0 + hi0) * 0.5;
  const span = (hi0 - lo0) * r.amp;
  const lo = Math.max(lo0, mid - span * 0.5);
  const hi = Math.min(hi0, mid + span * 0.5);
  let top = s.rng.rangeF(lo, hi);

  // The lever players feel most is not gap width but how far they must travel
  // between one gate and the next.
  if (s.lastTop !== null && r.delta < 1) {
    const md = VH * r.delta;
    top = clamp(top, s.lastTop - md, s.lastTop + md);
    top = clamp(top, lo0, hi0);
  }
  s.lastTop = top;

  const drift = r.drift ? VH * s.rng.rangeF(0.022, 0.048) : 0;
  s.gates.push({
    x: atX, top, base: top, gap: g, passed: false,
    drift, ph: s.rng.rangeF(0, TAU),
  });

  if (!s.rng.chance(r.dens)) return;

  let pick = '';
  if (r.ground && r.air) pick = s.rng.chance(0.5) ? 'g' : 'a';
  else if (r.ground) pick = 'g';
  else if (r.air) pick = 'a';
  // Never stack a ground hazard under a low gate — that is unfair, not hard.
  if (pick === 'g' && top + g > VH * 0.62) pick = r.air ? 'a' : '';

  if (pick === 'g') {
    s.hz.push({
      k: 'g', x: atX - s.m.gsp * 0.5, y: 0,
      w: Math.max(16, VW * 0.085), h: VH * s.rng.rangeF(0.06, 0.145), vx: 0,
    });
  } else if (pick === 'a') {
    const y0 = VH * s.rng.rangeF(0.13, 0.33);
    s.hz.push({
      k: 'a', x: atX - s.m.gsp * 0.5, y: VH * 0.2,
      w: Math.max(14, VW * 0.07), h: Math.max(10, VW * 0.048),
      y0, amp: VH * 0.045, ph: s.rng.rangeF(0, TAU), vx: 0.28,
    });
  }
}

// ------------------------------------------------------------- particles
// Atmosphere runs on Math.random, deliberately: it never touches the seeded
// stream, so turning it down for battery cannot change the course.
function newParticle(s: Sim, anywhere: boolean): Particle {
  const kind = CHAPTERS[s.palTo].kind;
  const p: Particle = {
    x: anywhere ? Math.random() * VW : VW + 10,
    y: Math.random() * VH * 0.86,
    z: 0.4 + Math.random() * 0.8,
    vx: -0.7, vy: -0.18, len: 0, r: 1,
  };
  if (kind === 'mast') { p.vx = -1.3; p.vy = 2.9; p.len = 6 + Math.random() * 9; }
  else if (kind === 'kelp') { p.vx = -0.25; p.vy = -(0.85 + Math.random() * 0.5); p.r = 1 + Math.random() * 2.4; }
  else if (kind === 'rib') { p.vx = -0.5; p.vy = 0.12; p.r = 0.9 + Math.random() * 1.7; }
  else { p.r = 0.9 + Math.random() * 1.6; }
  return p;
}

function initParticles(s: Sim): void {
  s.parts.length = 0;
  if (s.atmos === 0) return;
  const n = s.atmos === 1 ? Math.floor(PARTICLES * 0.4) : PARTICLES;
  for (let i = 0; i < n; i++) s.parts.push(newParticle(s, true));
}

function stepParticles(s: Sim, dt: number, spd: number): void {
  for (let i = 0; i < s.parts.length; i++) {
    const p = s.parts[i];
    p.x += (p.vx * spd * 0.35 - spd * 0.06) * dt * p.z;
    p.y += p.vy * spd * 0.35 * dt * p.z;
    if (p.x < -40 || p.y < -40 || p.y > VH + 40) s.parts[i] = newParticle(s, false);
  }
}

// ------------------------------------------------------------------ input
/**
 * Queue a flap. Returns true when one was actually taken, so the CALLER can
 * fire the sound and the haptic on the input event.
 *
 * That is deliberate and it is load-bearing: Game.gd fired feedback in
 * _queue_flap() rather than on the tick, because deferring it costs up to 8 ms
 * of latency for nothing. Only the physics waits for the tick. Routing the flap
 * through the per-tick event list looks tidier and is wrong — the list is
 * cleared at the top of step(), so the sound is thrown away before anyone can
 * play it.
 */
export function queueFlap(s: Sim, nowMs: number): boolean {
  if (s.countdown > 0) return false;
  if (s.phase === 'ready') {
    s.phase = 'play';
    s.startedAt = nowMs;
  }
  if (s.phase !== 'play') return false;
  s.flapQueued = true;
  return true;
}

/**
 * Whether a tap is allowed to restart. Config.RESTART_MS after a death every
 * input is ignored, because the tap that killed you is still in the air and
 * nobody wants to lose the score they just saw.
 */
export function canRestart(s: Sim, nowMs: number): boolean {
  return nowMs - s.diedAt >= RESTART_MS;
}

// ------------------------------------------------------------------ tick
export function step(s: Sim, nowMs: number): void {
  const dt = FIXED;
  s.events.length = 0;

  // The respawn countdown freezes the world. Godot paused the whole tree, so
  // `t` stopped too — and `t` drives gate drift, so advancing it here would
  // move the gates while the player watches a number count down.
  if (s.countdown > 0) { s.countdown = Math.max(0, s.countdown - dt); return; }

  s.t += dt;
  s.sinceFlap += dt;
  if (s.palT < 1) s.palT = Math.min(1, s.palT + dt / CROSSFADE_S);

  if (s.phase === 'ready') {
    s.y = VH * 0.42 + Math.sin(s.t * 3) * (VH * 0.012);
    stepParticles(s, dt, curSpd(s) * 0.25);
    return;
  }

  if (s.phase === 'dead') {
    s.vy += s.m.grav * dt * 1.4;
    s.y += s.vy * dt;
    s.rot = Math.min(1.6, s.rot + dt * 6);
    if (s.y > VH - VH * 0.14) { s.y = VH - VH * 0.14; s.vy = 0; }
    s.flash = Math.max(0, s.flash - dt * 4);
    stepParticles(s, dt, curSpd(s) * 0.3);
    return;
  }

  // ---- PLAY. The tick counter and the replay log advance together. ----
  s.tick += 1;
  if (s.flapQueued) {
    s.flapQueued = false;
    s.vy = -s.m.flap;
    s.sinceFlap = 0;
    s.flapTicks.push(s.tick);
  }

  const spd = curSpd(s);
  if (s.invuln > 0) s.invuln = Math.max(0, s.invuln - dt);
  s.vy = Math.min(s.vy + s.m.grav * dt, s.m.grav * TERMINAL_MULT);
  s.y += s.vy * dt;
  s.rot = clamp(s.vy / 900, -0.5, 1.4);
  s.dist += spd * dt;
  stepParticles(s, dt, spd);

  // Landmarks in the far parallax layer.
  s.nextProp -= spd * dt;
  if (s.nextProp <= 0 && s.atmos === 2) {
    s.props.push({ x: VW + 80, ci: s.palTo });
    s.nextProp = LANDMARK_GAP[0] + Math.random() * (LANDMARK_GAP[1] - LANDMARK_GAP[0]);
  }
  for (const p of s.props) p.x -= spd * 0.17 * dt;
  while (s.props.length && s.props[0].x < -VW * 0.6) s.props.shift();

  for (const g of s.gates) {
    g.x -= spd * dt;
    if (g.drift > 0) {
      g.top = clamp(g.base + Math.sin(s.t * 1.15 + g.ph) * g.drift, VH * 0.07, VH * 0.76 - g.gap);
    }
  }
  for (const z of s.hz) {
    z.x -= spd * dt * (z.k === 'a' ? 1 + z.vx : 1);
    if (z.k === 'a') z.y = (z.y0 ?? 0) + Math.sin(s.t * 1.6 + (z.ph ?? 0)) * (z.amp ?? 0);
  }
  while (s.gates.length && s.gates[0].x < -gateW() - 4) s.gates.shift();
  while (s.hz.length && s.hz[0].x < -VW * 0.2) s.hz.shift();

  const lastX = s.gates.length ? s.gates[s.gates.length - 1].x : 0;
  if (lastX < VW + s.m.gsp) spawn(s, lastX + s.m.gsp);

  collide(s, nowMs);
}

// ---------------------------------------------------------------- collision
export function hitbox(s: Sim) {
  const f = s.m.hit;
  const bw = doveW() * f;
  const bh = doveH() * f;
  return { x: VW * 0.26 - bw * 0.5, y: s.y - bh * 0.5, w: bw, h: bh };
}

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function collide(s: Sim, nowMs: number): void {
  const b = hitbox(s);
  const gw = gateW();
  let touch = false;
  let cause: DeathCause = 'gate';

  for (const g of s.gates) {
    if (overlaps(b, { x: g.x, y: 0, w: gw, h: g.top })
      || overlaps(b, { x: g.x, y: g.top + g.gap, w: gw, h: VH - g.top - g.gap })) {
      touch = true;
    }
    if (!g.passed && g.x + gw < b.x) {
      g.passed = true;
      s.score += 1;
      s.feathers += 1;
      s.events.push('gate');
      const ci = chapterIndex(s.score);
      if (ci !== s.palTo) {
        s.palFrom = s.palTo;
        s.palTo = ci;
        s.palT = 0;
        s.events.push('chapter');
      }
    }
  }

  for (const z of s.hz) {
    const r = z.k === 'g'
      ? { x: z.x, y: VH * GROUND - z.h, w: z.w, h: z.h }
      : { x: z.x, y: z.y - z.h * 0.5, w: z.w, h: z.h };
    if (overlaps(b, r)) {
      touch = true;
      cause = z.k === 'g' ? 'ground_hazard' : 'air_hazard';
    }
  }

  if (s.y + b.h * 0.5 > VH - VH * 0.12) { touch = true; cause = 'floor'; }
  if (s.y - b.h * 0.5 < 0) { s.y = b.h * 0.5; s.vy = 0; }

  // Coyote time. A frame of contact is not a death; m.coy seconds of it is.
  if (touch) {
    s.grace += FIXED;
    if (s.grace > s.m.coy) { s.deathCause = cause; die(s, nowMs); }
  } else {
    s.grace = 0;
  }
}

export function die(s: Sim, nowMs: number): void {
  if (s.phase !== 'play' || s.invuln > 0) return;
  s.phase = 'dead';
  s.diedAt = nowMs;
  s.flash = 1;
  s.sessionDeaths += 1;
  s.events.push('death');
  s.swOffer = !s.swUsed && s.score >= SW_MIN_SCORE && s.sessionDeaths >= SW_MIN_SESSION_DEATHS;
  if (s.tutorial) s.swOffer = false;
}

// -------------------------------------------------------------- continuing
// The detail everyone gets wrong: clear the obstacles ahead, or the player
// pays and dies instantly to the same gate they just died to.
export function continueRun(s: Sim): void {
  const clearTo = VW * 0.26 + doveW() * SW_CLEAR_AHEAD;
  for (const g of s.gates) {
    if (g.x < clearTo && !g.passed) { g.passed = true; g.x = -9999; }
  }
  s.hz = s.hz.filter((z) => z.x >= clearTo);
  s.y = VH * 0.42;
  s.vy = 0;
  s.rot = 0;
  s.grace = 0;
  s.phase = 'play';
  s.invuln = SW_INVULN_S;
  s.countdown = SW_COUNTDOWN_S;
  s.respawnUsed = true;
  s.events.push('continue');
}

export function secondWind(s: Sim): void {
  s.swUsed = true;
  s.swOffer = false;
  continueRun(s);
}

/**
 * The replay log: flap ticks, delta-encoded as varints, base64. A ninety-second
 * run is about 150 flaps — roughly 300 bytes on the wire. Stored from day one
 * so historical runs become checkable the day a validator lands.
 */
export function replayBlob(s: Sim): string {
  const bytes: number[] = [];
  let prev = 0;
  for (const tick of s.flapTicks) {
    let d = tick - prev;
    prev = tick;
    while (d >= 0x80) { bytes.push((d & 0x7f) | 0x80); d >>>= 7; }
    bytes.push(d);
  }
  // Hand-rolled so this file runs unchanged in the browser and in `node --test`.
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let outStr = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    outStr += A[b0 >> 2];
    outStr += A[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    outStr += b1 === undefined ? '=' : A[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    outStr += b2 === undefined ? '=' : A[b2 & 63];
  }
  return outStr;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
