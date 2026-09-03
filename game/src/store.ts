// Everything the game remembers about this device.
//
// Local-first, and that is not a slogan: the disk save is the source of truth
// and the network is a convenience. Every read below works with no connection,
// and every one of them has to survive `localStorage` throwing — which it does
// in a private window, in a WebView with site data blocked, and inside a
// thumbnail capture.

const KEY = 'dovefall.v1';

export interface Settings {
  music: 0 | 1 | 2;
  sfx: boolean;
  haptics: boolean;
  atmos: 0 | 1 | 2;
  flashing: boolean;
  lefthand: boolean;
  mode: 'easy' | 'normal' | 'hard' | 'pro';
  skin: string;
  lang: 'en' | 'sw';
  theme: 'auto' | 'light' | 'dark';
  fontScale: 0 | 1 | 2 | 3;
}

export interface Save {
  rev: number;
  installId: string;
  bests: Record<string, number>;
  feathers: number;
  owned: string[];
  tutorialDone: boolean;
  sessionDeaths: number;
  settings: Settings;
  /** Server identity, mirrored so the title screen can render offline. */
  name: string;
  tag: string;
  token: string;
  playStreak: number;
  dailyStreak: number;
  respawns: number;
}

const DEFAULTS: Save = {
  rev: 0,
  installId: '',
  bests: {},
  feathers: 0,
  owned: ['dove'],
  tutorialDone: false,
  sessionDeaths: 0,
  settings: {
    music: 2, sfx: true, haptics: true, atmos: 2, flashing: false,
    lefthand: false, mode: 'normal', skin: 'dove', lang: 'en',
    theme: 'auto', fontScale: 1,
  },
  name: '',
  tag: '',
  token: '',
  playStreak: 0,
  dailyStreak: 0,
  respawns: 0,
};

function newInstallId(): string {
  // OS.get_unique_id() is empty on the web, so the install id is ours to make.
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let cached: Save | null = null;

export function load(): Save {
  if (cached) return cached;
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* private window */ }
  let s: Save = { ...DEFAULTS, settings: { ...DEFAULTS.settings } };
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<Save>;
      s = { ...s, ...p, settings: { ...s.settings, ...(p.settings ?? {}) } };
    } catch { /* corrupt: start clean rather than refuse to boot */ }
  }
  if (!s.installId) s.installId = newInstallId();
  cached = s;
  return s;
}

export function save(patch: Partial<Save>): Save {
  const next = { ...load(), ...patch, rev: load().rev + 1 };
  cached = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* nothing to do */ }
  return next;
}

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]): Save {
  const s = load();
  return save({ settings: { ...s.settings, [k]: v } });
}

export function bestFor(mode: string): number {
  return load().bests[mode] ?? 0;
}

/** Returns true when this run set a personal best. Writes only on improvement. */
export function recordRun(mode: string, score: number, feathers: number): boolean {
  const s = load();
  const pb = score > (s.bests[mode] ?? 0);
  save({
    bests: pb ? { ...s.bests, [mode]: score } : s.bests,
    feathers: s.feathers + feathers,
  });
  return pb;
}
