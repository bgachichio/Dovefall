// The frame loop, the canvas sizing, and the input. Deliberately outside React:
// a 120 Hz accumulator must never wait on a render, and a tap must never wait
// on a state update.

import { draw, lookOf } from './render.ts';
import { FIXED } from './constants.ts';
import { VW, VH, step, queueFlap, type Sim } from './sim.ts';

/** Above 3x the extra pixels cost battery and buy nothing: the design canvas is
 *  1080 wide, and 3x on a 360 CSS px phone is already 1080. */
const DPR_CAP = 3;
/** Never take more than a quarter second of catch-up in one frame. Returning
 *  from a locked screen must not deliver two thousand physics steps. */
const MAX_CATCHUP = 0.25;

export interface LoopHandle {
  stop(): void;
  resize(): void;
  /** CSS pixels of the drawing box, and the scale from design units to them. */
  metrics(): { w: number; h: number; scale: number; dpr: number };
}

export interface LoopOptions {
  canvas: HTMLCanvasElement;
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

  function resize(): void {
    const box = canvas.parentElement ?? canvas;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (w < 1 || h < 1) return;
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    cssW = w;
    cssH = h;
    scale = Math.min(w / VW, h / VH);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
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
    while (acc >= FIXED && steps < 32) {
      step(sim, now);
      if (sim.events.length && o.onEvents) o.onEvents(sim.events.slice(), sim);
      acc -= FIXED;
      steps++;
    }

    // Letterbox in the sky colour of the chapter in force, so the bars read as
    // part of the world rather than as a frame around it.
    const look = lookOf(sim);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = look.sky;
    g.fillRect(0, 0, cssW, cssH);

    g.save();
    g.translate((cssW - VW * scale) / 2, (cssH - VH * scale) / 2);
    g.scale(scale, scale);
    g.beginPath();
    g.rect(0, 0, VW, VH);
    g.clip();
    draw(g, sim, o.getSkin());
    g.restore();

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
export function attachInput(el: HTMLElement, sim: () => Sim | null): () => void {
  const tap = (e: Event) => {
    const s = sim();
    if (!s) return;
    e.preventDefault();
    queueFlap(s, performance.now());
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
