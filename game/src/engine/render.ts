// Drawing. Everything here reads the sim and writes pixels; nothing here
// changes the sim, so a rendering bug can never change a score.
//
// The whole art set is text. A sprite is an array of strings, one character per
// pixel, and a palette maps characters to colours — which is why six dove skins
// cost nothing and the entire art budget is about 6 KB. Each sprite is rasterised
// once into an offscreen canvas per (sprite, palette, size) and cached.

import {
  CHAPTERS, SKINS, DOVE_FRAMES, GROUND_HZ, AIR_HZ, GATE_PATTERN, LANDMARKS,
  DOVE_W, DOVE_H, ATMOS_BACKDROP, ATMOS_OBSTACLE, FLASH_ALPHA_MAX,
  LIGHT_MIN, LIGHT_MAX, DUSK_WARM, DAY_LENGTH_PX,
} from './constants.ts';
import { VW, VH, GROUND, dsize, doveW, doveH, gateW, type Sim } from './sim.ts';

type Palette = Record<string, string>;
type Sprite = readonly string[];

const cache = new Map<string, HTMLCanvasElement>();

/** Rasterise a text sprite once. `px` is the size of one sprite pixel. */
function raster(key: string, map: Sprite, pal: Palette, px: number): HTMLCanvasElement {
  const id = `${key}|${px}|${Object.values(pal).join('')}`;
  const hit = cache.get(id);
  if (hit) return hit;

  const w = Math.max(...map.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w * px);
  c.height = Math.max(1, map.length * px);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  for (let row = 0; row < map.length; row++) {
    const line = map[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      const colour = pal[ch];
      if (!colour) continue;
      g.fillStyle = colour;
      g.fillRect(col * px, row * px, px, px);
    }
  }
  // The cache is unbounded only in theory: sprites x skins x one pixel size.
  if (cache.size > 200) cache.clear();
  cache.set(id, c);
  return c;
}

// ------------------------------------------------------------------ colour
//
// Colours travel as numeric triples from the moment they leave the palette
// until the moment they reach the canvas. An earlier version cross-faded to an
// "rgb(...)" string and then fed it back into a "#rrggbb" parser, which
// produced NaN — and a NaN fill is not an error, it is a black screen.

type RGB = [number, number, number];

function hex(c: string): RGB {
  const p = parseInt(c.slice(1), 16);
  return [(p >> 16) & 255, (p >> 8) & 255, p & 255];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Day/night, applied at full strength to the backdrop and half to obstacles. */
const light = (c: RGB, amount: number, warmth: number): RGB => [
  Math.min(255, c[0] * amount + 255 * warmth * 0.10),
  Math.min(255, c[1] * amount + 255 * warmth * 0.04),
  Math.min(255, c[2] * amount),
];

const css = (c: RGB): string =>
  `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

export interface Look {
  sky: string; far: string; mid: string; gnd: string;
  ob: string; obd: string; obt: string; hzg: string; hza: string;
  kind: string;
}

/** The palette in force right now: two chapters cross-faded, then the day curve. */
export function lookOf(s: Sim): Look {
  const a = CHAPTERS[s.palFrom];
  const b = CHAPTERS[s.palTo];
  const t = s.palT;
  const phase = (s.dist % DAY_LENGTH_PX) / DAY_LENGTH_PX;
  const daylight = LIGHT_MIN + (LIGHT_MAX - LIGHT_MIN) * (0.5 + 0.5 * Math.cos(phase * Math.PI * 2));
  const warm = DUSK_WARM * Math.max(0, Math.sin(phase * Math.PI * 2));

  const backdrop = 1 - (1 - daylight) * ATMOS_BACKDROP;
  const obstacle = 1 - (1 - daylight) * ATMOS_OBSTACLE;
  const key = (k: 'sky' | 'far' | 'mid' | 'gnd' | 'ob' | 'obd' | 'obt' | 'hzg' | 'hza') =>
    mix(hex(a[k]), hex(b[k]), t);

  return {
    sky: css(light(key('sky'), backdrop, warm)),
    far: css(light(key('far'), backdrop, warm)),
    mid: css(light(key('mid'), backdrop, warm)),
    gnd: css(light(key('gnd'), backdrop, warm)),
    ob: css(light(key('ob'), obstacle, warm)),
    obd: css(light(key('obd'), obstacle, warm)),
    obt: css(light(key('obt'), obstacle, warm)),
    hzg: css(light(key('hzg'), obstacle, warm)),
    hza: css(light(key('hza'), obstacle, warm)),
    kind: (t < 0.5 ? a.kind : b.kind) as string,
  };
}

// ------------------------------------------------------------------ draw
export function draw(g: CanvasRenderingContext2D, s: Sim, skinId: string): void {
  const L = lookOf(s);
  const px = dsize();
  g.imageSmoothingEnabled = false;

  // sky and the three parallax bands
  g.fillStyle = L.sky;
  g.fillRect(0, 0, VW, VH);

  drawLandmarks(g, s, L, px);

  const horizon = VH * 0.70;
  g.fillStyle = L.far;
  g.fillRect(0, horizon, VW, VH - horizon);
  g.fillStyle = L.mid;
  g.fillRect(0, VH * 0.80, VW, VH * 0.20);
  g.fillStyle = L.gnd;
  g.fillRect(0, VH * GROUND, VW, VH * (1 - GROUND));

  drawParticles(g, s, L);
  drawGates(g, s, L, px);
  drawHazards(g, s, L, px);
  drawDove(g, s, skinId, px);

  // Death flash, capped for photosensitivity.
  if (s.flash > 0) {
    g.fillStyle = `rgba(255,255,255,${(s.flash * FLASH_ALPHA_MAX).toFixed(3)})`;
    g.fillRect(0, 0, VW, VH);
  }
}

function drawLandmarks(g: CanvasRenderingContext2D, s: Sim, L: Look, px: number): void {
  for (const p of s.props) {
    const kind = CHAPTERS[p.ci].kind as keyof typeof LANDMARKS;
    const map = LANDMARKS[kind];
    if (!map) continue;
    const sprite = raster(`lm-${kind}`, map, { W: L.far }, px * 2);
    g.drawImage(sprite, Math.round(p.x), Math.round(VH * 0.70 - sprite.height));
  }
}

function drawGates(g: CanvasRenderingContext2D, s: Sim, L: Look, px: number): void {
  const w = gateW();
  const kind = L.kind as keyof typeof GATE_PATTERN;
  const pattern = GATE_PATTERN[kind];
  const tile = pattern
    ? raster(`gp-${kind}`, pattern, { K: L.obd, L: L.obt }, Math.max(1, Math.round(w / 8)))
    : null;

  for (const gate of s.gates) {
    const x = Math.round(gate.x);
    if (x > VW || x + w < 0) continue;
    const top = Math.round(gate.top);
    const bottomY = Math.round(gate.top + gate.gap);

    for (const [y, h] of [[0, top], [bottomY, VH - bottomY]] as const) {
      if (h <= 0) continue;
      g.fillStyle = L.ob;
      g.fillRect(x, y, w, h);
      if (tile) {
        g.save();
        g.beginPath();
        g.rect(x, y, w, h);
        g.clip();
        for (let ty = y; ty < y + h; ty += tile.height) g.drawImage(tile, x, ty);
        g.restore();
      }
      // Lip: the eye reads the opening, so the opening gets the contrast.
      g.fillStyle = L.obt;
      const lip = Math.max(6, px * 2);
      g.fillRect(x - px, y === 0 ? top - lip : bottomY, w + px * 2, lip);
    }
  }
}

function drawHazards(g: CanvasRenderingContext2D, s: Sim, L: Look, px: number): void {
  const kind = L.kind as keyof typeof GROUND_HZ;
  for (const z of s.hz) {
    if (z.x > VW || z.x + z.w < 0) continue;
    if (z.k === 'g') {
      const map = GROUND_HZ[kind];
      if (!map) continue;
      const size = Math.max(1, Math.round(z.h / map.length));
      const sprite = raster(`gh-${kind}`, map, { W: L.hzg, K: L.obd, L: L.obt }, size);
      g.drawImage(sprite, Math.round(z.x), Math.round(VH * GROUND - sprite.height));
    } else {
      const map = AIR_HZ[kind];
      if (!map) continue;
      const size = Math.max(1, Math.round(z.h / map.length));
      const sprite = raster(`ah-${kind}`, map, { W: L.hza, K: L.obd, O: L.obt }, size);
      g.drawImage(sprite, Math.round(z.x), Math.round(z.y - sprite.height / 2));
    }
    void px;
  }
}

function drawDove(g: CanvasRenderingContext2D, s: Sim, skinId: string, px: number): void {
  const skin = SKINS.find((k) => k.id === skinId) ?? SKINS[0];
  const pal: Palette = { W: skin.W, G: skin.G, D: skin.D, E: skin.E, O: skin.O };
  const frame = frameFor(s);
  const sprite = raster(`dove-${skinId}-${frame}`, DOVE_FRAMES[frame], pal, px);

  g.save();
  g.translate(VW * 0.26, s.y);
  g.rotate(s.rot);
  if (s.invuln > 0) g.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(s.t * 18));
  g.drawImage(sprite, -doveW() / 2, -doveH() / 2, DOVE_W * px, DOVE_H * px);
  g.restore();
}

/** The wing leads the movement rather than following it — that is what makes a
 *  tap feel like it caused something. */
function frameFor(s: Sim): number {
  if (s.phase === 'dead') return 2;
  const FLAP_SEQUENCE = [0, 0, 3, 3, 1];
  const i = Math.floor(s.sinceFlap / 0.055);
  return FLAP_SEQUENCE[Math.min(i, FLAP_SEQUENCE.length - 1)];
}

function drawParticles(g: CanvasRenderingContext2D, s: Sim, L: Look): void {
  if (!s.parts.length) return;
  g.save();
  g.globalAlpha = 0.5;
  g.strokeStyle = L.hza;
  g.fillStyle = L.hza;
  for (const p of s.parts) {
    if (p.len > 0) {
      g.lineWidth = Math.max(1, p.z * 2);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.len * 0.4, p.y + p.len);
      g.stroke();
    } else {
      g.beginPath();
      g.arc(p.x, p.y, p.r * p.z * 2, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}
