// A dead run, carried across the one reload that can happen mid-death.
//
// Tapping "Pay with Paystack" leaves this tab entirely — Paystack's own
// "Redirect after payment" setting is what brings it back, but that return
// trip is a fresh page load. The in-memory sim, gates and all, does not
// survive that; nothing does, short of putting a copy somewhere that does.
// This is that somewhere: a one-shot snapshot, written the instant "More
// hearts" is tapped from a dead run and taken the instant a fresh boot's
// ?paid=1 marker says this load IS that return trip — so the credit that
// follows can put the player back exactly where they fell instead of just
// updating a balance on a screen with nothing behind it.

import { Rng } from './engine/rng.ts';
import { MODES, RESTART_MS } from './engine/constants.ts';
import type { Sim, Mode } from './engine/sim.ts';

const KEY = 'dovefall.deadrun.v1';
// Long enough to survive a slow checkout; short enough that a payment
// abandoned hours ago does not resurrect a run nobody is coming back to.
const TTL_MS = 20 * 60_000;

export function persistDeadRun(s: Sim): void {
  if (s.phase !== 'dead') return;
  try {
    const { m: _m, rng, ...rest } = s;
    localStorage.setItem(KEY, JSON.stringify({
      at: Date.now(),
      sim: { ...rest, rng: { state: rng.state, currentSeed: rng.currentSeed } },
    }));
  } catch { /* best effort — worst case the credit only updates the balance */ }
}

/** One-shot: removed whether or not it turns out to be usable. */
export function takeDeadRun(): Sim | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
  } catch { return null; }
  if (!raw) return null;
  try {
    const { at, sim } = JSON.parse(raw);
    if (typeof at !== 'number' || Date.now() - at > TTL_MS) return null;
    const rng = Object.assign(new Rng(sim.seed), sim.rng);
    return {
      ...sim,
      m: MODES[sim.mode as keyof typeof MODES] as Mode,
      rng,
      // performance.now() resets to ~0 on this fresh page; the old value is
      // not merely stale, it is measuring a different clock. Back-date it
      // so the death is already past RESTART_MS on THIS page's clock,
      // rather than reporting a wait of tens of minutes.
      diedAt: performance.now() - RESTART_MS,
      startedAt: performance.now() - RESTART_MS,
    };
  } catch {
    return null;
  }
}
