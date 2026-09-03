// The frame loop, the canvas sizing, and the input. Deliberately outside React:
// a 120 Hz accumulator must never wait on a render, and a tap must never wait
// on a state update.

import { draw, lookOf } from './render.ts';
import { FIXED } from './constants.ts';
import { VW, VH, step, queueFlap, type Sim } from './sim.ts';

/** Above 3x the extra pixels cost battery and buy nothing: the design canvas is
 *  1080 wide, and 3x on a 360 CSS px phone is already 1080. */
const DPR_CAP = 3;
/**
 * Spiral-of-death guard, matched to the Godot project's
 * `physics/common/max_physics_steps_per_frame = 12`. Returning from a locked
 * screen must not deliver a thousand physics steps at once, and it must not
 * deliver more than the Android build would have: twelve ticks is a tenth of a
 * second of world, and anything older than that is simply dropped.
 */
export const MAX_STEPS_PER_FRAME = 12;
const MAX_CATCHUP = MAX_STEPS_PER_FRAME * FIXED;

export interface LoopHandle {
  stop(): void;
  resize(): void;
  /** CSS pixels of the drawing box, and the scale from design units to them. */
  metrics(): { w: number; h: number; scale: number; dpr: number };
}

export interface LoopOptions {
  canvas: HTMLCanvasElement;
  /** The box the playfield is fitted into — the whole visible area. */
  frame: HTMLElement;
  /** Sized by the loop to exactly the fitted playfield, and centred in the
   *  frame. The HUD lives inside it, so it lines up with the game on a wide
   *  screen instead of spreading to the window edges. */
  stage: HTMLElement;
  /** Called every frame with the live sim, for HUD state. */
  onFrame?: (s: Sim) => void;
  /** Called once per tick with the events the sim raised — sound, haptics. */
  onEvents?: (events: string[], s: Sim) => void;
  getSim: () => Sim | null;
  getSkin: () => string;
  paused: () => boolean;
}

export function startLoop(o: LoopOptions): LoopHandle {
  const { canvas } = o;
  const g = canvas.getContext('2d', { alpha: false })!;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let cssW = 1;
  let cssH = 1;
  let scale = 1;
  let dpr = 1;
  let lastSky = '';

  function resize(): void {
    const availW = o.frame.clientWidth;
    const availH = o.frame.clientHeight;
    if (availW < 1 || availH < 1) return;

    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    scale = Math.min(availW / VW, availH / VH);

    // The canvas is exactly the fitted playfield, not the whole window. On a
    // phone that is the full width; on a laptop it is a centred portrait
    // column, and the surround is painted by the frame in the chapter's sky.
    // Sizing it this way is also what keeps the HUD attached to the game.
    cssW = Math.round(VW * scale);
    cssH = Math.round(VH * scale);
    o.stage.style.width = `${cssW}px`;
    o.stage.style.height = `${cssH}px`;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const sim = o.getSim();
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (!sim) return;
    if (o.paused()) { acc = 0; return; }

    if (dt > MAX_CATCHUP) dt = MAX_CATCHUP;
    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < MAX_STEPS_PER_FRAME) {
      step(sim, now);
      if (sim.events.length && o.onEvents) o.onEvents(sim.events.slice(), sim);
      acc -= FIXED;
      steps++;
    }

    // The surround takes the sky colour of the chapter in force, so the bars
    // read as part of the world rather than as a frame around it — and they
    // follow the palette through the chapter cross-fades.
    const look = lookOf(sim);
    if (look.sky !== lastSky) {
      lastSky = look.sky;
      o.frame.style.backgroundColor = look.sky;
    }

    g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    draw(g, sim, o.getSkin());

    o.onFrame?.(sim);
  }

  resize();
  raf = requestAnimationFrame(frame);

  return {
    stop() { cancelAnimationFrame(raf); },
    resize,
    metrics: () => ({ w: cssW, h: cssH, scale, dpr }),
  };
}

/** Wire taps and the space bar to a flap. Pointer events, because they fire
 *  before the 300 ms click and cover mouse, pen and finger in one path. */
export function attachInput(
  el: HTMLElement,
  sim: () => Sim | null,
  onFlap?: () => void,
): () => void {
  const tap = (e: Event) => {
    const s = sim();
    if (!s) return;
    e.preventDefault();
    if (queueFlap(s, performance.now())) onFlap?.();
  };
  const key = (e: KeyboardEvent) => {
    if (e.code !== 'Space' && e.code !== 'ArrowUp' && e.code !== 'Enter') return;
    if (e.repeat) return;
    tap(e);
  };
  el.addEventListener('pointerdown', tap, { passive: false });
  window.addEventListener('keydown', key);
  return () => {
    el.removeEventListener('pointerdown', tap);
    window.removeEventListener('keydown', key);
  };
}
