// A dead run has to survive the one reload the Paystack redirect forces —
// this is the part of that promise with no DOM to prove it in, so it is
// proven here: persist, take, and the two ways taking it can correctly
// come back empty (nothing there, or too old to trust).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Plain Node has no localStorage. A tiny in-memory shim is enough for
// persistDeadRun/takeDeadRun, which only ever call get/set/remove.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { persistDeadRun, takeDeadRun } = await import('../src/deadrun.ts');
const { createSim, die, spawn } = await import('../src/engine/sim.ts');

function deadSim(overrides = {}) {
  const s = createSim({ mode: 'normal', seed: 0xd0fe, ...overrides });
  s.score = 42;
  s.phase = 'play';
  die(s, 1000);
  return s;
}

test('a dead run round-trips through persist and take', () => {
  const s = deadSim();
  // A real "More hearts" tap persists mid-flight state a fresh createSim()
  // would not have — prove drift in the gates/hazards survives too.
  spawn(s, 3000);
  const gatesBefore = s.gates.map((g) => ({ x: g.x, top: g.top, drift: g.drift }));

  store.clear();
  persistDeadRun(s);
  const restored = takeDeadRun();

  assert.ok(restored, 'nothing came back');
  assert.equal(restored.phase, 'dead');
  assert.equal(restored.score, 42);
  assert.equal(restored.mode, 'normal');
  assert.equal(restored.seed, s.seed);
  assert.deepEqual(restored.gates.map((g) => ({ x: g.x, top: g.top, drift: g.drift })), gatesBefore);
  // The reconstructed Rng is a real instance, not a plain object with the
  // right shape — continuing the run has to be able to call .next() on it.
  assert.equal(typeof restored.rng.next, 'function');
  assert.equal(restored.rng.state, s.rng.state);
  // m is derived, not stored — MODES.normal, correctly re-attached.
  assert.equal(restored.m.grav, s.m.grav);
});

test('taking a dead run clears it — the redirect fires this boot only', () => {
  const s = deadSim();
  store.clear();
  persistDeadRun(s);
  assert.ok(takeDeadRun(), 'first take should find it');
  assert.equal(takeDeadRun(), null, 'second take found a run that should be gone');
});

test('a run persisted while still alive is not taken', () => {
  const s = createSim({ mode: 'normal', seed: 1 });
  s.phase = 'play'; // never died
  store.clear();
  persistDeadRun(s);
  assert.equal(store.size, 0, 'persistDeadRun wrote something for a live run');
});

test('diedAt is rewritten to this page\'s own clock, already past RESTART_MS', async () => {
  const { RESTART_MS } = await import('../src/engine/constants.ts');
  const s = deadSim();
  s.diedAt = 999_999_999; // whatever the OLD page's performance.now() said
  store.clear();
  persistDeadRun(s);
  const restored = takeDeadRun();
  const nowOnThisPage = performance.now();
  assert.ok(
    nowOnThisPage - restored.diedAt >= RESTART_MS,
    `restored diedAt (${restored.diedAt}) is not already past RESTART_MS on this page's clock (${nowOnThisPage})`,
  );
});

test('a run older than the TTL is not resurrected', () => {
  const s = deadSim();
  store.clear();
  persistDeadRun(s);
  const raw = JSON.parse(localStorage.getItem('dovefall.deadrun.v1'));
  raw.at = Date.now() - 21 * 60_000; // just past the 20-minute TTL
  localStorage.setItem('dovefall.deadrun.v1', JSON.stringify(raw));
  assert.equal(takeDeadRun(), null, 'a stale run should not come back');
});

test('corrupt or missing storage fails soft — never throws', () => {
  store.clear();
  assert.equal(takeDeadRun(), null);
  store.set('dovefall.deadrun.v1', 'not json at all {{{');
  assert.equal(takeDeadRun(), null);
});
