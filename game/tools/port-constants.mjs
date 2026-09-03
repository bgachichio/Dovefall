#!/usr/bin/env node
// Ports the game's tuning constants out of the Godot project and into
// TypeScript, mechanically.
//
// Every number that decides how Dovefall plays — gravity, flap impulse, gap
// width, the band table, the chapter palettes, the pixel maps — was tuned in
// GDScript over the life of the Android build. Retyping them by hand would
// introduce exactly the kind of one-digit error nobody finds until a player
// says "it feels wrong". So we transform the source instead.
//
// GDScript's literal syntax is close enough to JavaScript's that the whole
// job is four substitutions and a strip of comments.
//
//   node tools/port-constants.mjs <godot-project> > src/engine/constants.ts

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const project = process.argv[2];
if (!project || !existsSync(join(project, 'autoload', 'Config.gd'))) {
  console.error('usage: node tools/port-constants.mjs <godot-project-root>');
  process.exit(1);
}

// Strip trailing comments, but never inside a string — the pixel maps are
// strings and the palettes are "#RRGGBB".
function stripComments(src) {
  return src.split('\n').map((line) => {
    let quote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i - 1] !== '\\') quote = !quote;
      else if (c === '#' && !quote) return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

function constants(src) {
  const out = new Map();
  const lines = stripComments(src).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^const ([A-Z_0-9]+) := (.*)$/.exec(lines[i]);
    if (!m) continue;
    let [, name, value] = m;
    // Balance brackets across lines.
    const depth = (s) => {
      let d = 0, q = false;
      for (let k = 0; k < s.length; k++) {
        const c = s[k];
        if (c === '"' && s[k - 1] !== '\\') q = !q;
        else if (!q && (c === '[' || c === '{')) d++;
        else if (!q && (c === ']' || c === '}')) d--;
      }
      return d;
    };
    let d = depth(value);
    while (d > 0 && i + 1 < lines.length) {
      i++;
      value += '\n' + lines[i];
      d = depth(value);
    }
    out.set(name, value.trim());
  }
  return out;
}

function toJs(gd) {
  return gd
    .replace(/Vector2\(([^)]*)\)/g, '[$1]')          // Vector2(a, b) -> [a, b]
    .replace(/Color\("(#[0-9A-Fa-f]{6})"\)/g, '"$1"') // Color("#hex") -> "#hex"
    .replace(/\bPI\b/g, 'Math.PI')
    .replace(/\btrue\b/g, 'true')
    .replace(/\bfalse\b/g, 'false');
}

const config = constants(readFileSync(join(project, 'autoload', 'Config.gd'), 'utf8'));
const art = constants(readFileSync(join(project, 'autoload', 'Art.gd'), 'utf8'));

// Only what the web build actually uses. A constant nobody reads is bloat,
// and the audit already removed one round of it.
const WANT_CONFIG = [
  'VERSION', 'FIXED', 'TERMINAL_MULT', 'RESTART_MS', 'DDA_WIDEN',
  'MODES', 'MODE_ORDER', 'BANDS', 'RAMP', 'CHAPTERS',
  'DAY_LENGTH_PX', 'CROSSFADE_S', 'LIGHT_MIN', 'LIGHT_MAX', 'DUSK_WARM',
  'ATMOS_BACKDROP', 'ATMOS_OBSTACLE', 'PARTICLES', 'LANDMARK_GAP', 'FLASH_ALPHA_MAX',
  'DOVE_W', 'DOVE_H', 'DOVE_DIVISOR', 'SKINS',
  'SW_MIN_SCORE', 'SW_MIN_SESSION_DEATHS', 'SW_CLEAR_AHEAD', 'SW_INVULN_S', 'SW_COUNTDOWN_S',
  'NAVY', 'COPPER', 'GOLD', 'INK', 'PAPER', 'STRINGS',
];
const WANT_ART = [
  'DOVE_FRAMES', 'FLAP_SEQUENCE', 'FLAP_FRAME_S',
  'GROUND_HZ', 'AIR_HZ', 'GATE_PATTERN', 'LANDMARKS',
];

const missing = [
  ...WANT_CONFIG.filter((k) => !config.has(k)).map((k) => `Config.${k}`),
  ...WANT_ART.filter((k) => !art.has(k)).map((k) => `Art.${k}`),
];
if (missing.length) {
  console.error(`\n  not found in the Godot project: ${missing.join(', ')}\n`);
  process.exit(1);
}

const body = [];
// `as const` narrows literals, which is what we want for the tables — but it is
// illegal on an expression, and FIXED is `1.0 / 120.0`. Assert only literals.
const literal = (v) => /^[[{"']/.test(v.trim()) || /^-?[\d.]+$/.test(v.trim());
const emit = (k, v) => `export const ${k} = ${v}${literal(v) ? ' as const' : ''};`;
for (const k of WANT_CONFIG) body.push(emit(k, toJs(config.get(k))));
for (const k of WANT_ART) body.push(emit(k, toJs(art.get(k))));

const header = `// GENERATED — do not edit by hand.
//
//   npm run port -- <godot-project>
//
// Transformed from autoload/Config.gd and autoload/Art.gd of the Dovefall
// Godot project. These are the tuned numbers from the Android build: change
// one here and the web game stops being the same game.
//
// The server's copy of the RNG (worker/src/rng.js) and its plausibility bounds
// (worker/src/bounds.js) are derived from these same values, which is what
// makes a score submitted by this client checkable by that server.
`;

process.stdout.write(`${header}\n${body.join('\n\n')}\n`);
