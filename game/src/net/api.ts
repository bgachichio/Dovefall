// The client for the Dovefall API.
//
// Three rules, and they are the reason the game is playable on a Nairobi train:
//
//   1. Nothing here is ever awaited by the game loop.
//   2. Every call fails soft — a rejected promise means "no network", never
//      "the game is broken".
//   3. The local save is authoritative. The server is where scores go to be
//      compared, not where they are kept.

import { load, save } from '../store.ts';

/**
 * Set at build time. Empty means the game runs entirely offline, which is a
 * valid state and the fastest rollback there is — no server, no bill, and the
 * game still plays.
 *
 * `?api=` overrides it, but ONLY on localhost. A session token is a bearer
 * credential, so a link that could repoint the live game at someone else's
 * server would be a token-exfiltration bug wearing a debugging hat. On a real
 * host the parameter is ignored.
 */
function resolveBase(): string {
  const built = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');
  if (typeof location === 'undefined') return built;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!local) return built;
  const override = new URLSearchParams(location.search).get('api');
  return override ? override.replace(/\/$/, '') : built;
}

export const API_BASE = resolveBase();
export const SHARE_URL = import.meta.env?.VITE_SHARE_URL ?? 'https://gachichio.org/dovefallgame';

export interface BoardEntry { rank: number; name: string; tag: string; score: number; at?: number; current?: number; }
export interface Streaks {
  play: { current: number; best: number; alive: boolean };
  daily: { current: number; best: number; alive: boolean };
  outcome?: string;
}
export interface Me { id: string; name: string; tag: string; respawns: number; streaks: Streaks; }

export const online = () => API_BASE !== '';

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 6000): Promise<T> {
  if (!online()) throw new Error('offline');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const token = load().token;
    const res = await fetch(API_BASE + path, {
      ...init,
      signal: ctl.signal,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error((body as { message?: string }).message || res.statusText), { status: res.status, body });
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/** A guest account: a chosen name, a derived tag, and a token held on this
 *  device. No email address is ever asked for. */
export async function signInGuest(name?: string): Promise<Me & { token: string }> {
  const s = load();
  const r = await call<Me & { token: string }>('/v1/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ device_id: s.installId, name: name || s.name || undefined }),
  });
  save({ token: r.token, name: r.name, tag: r.tag, respawns: r.respawns ?? 0 });
  return r;
}

export async function me(): Promise<Me> {
  const r = await call<Me>('/v1/me');
  save({ name: r.name, tag: r.tag, respawns: r.respawns ?? 0 });
  return r;
}

export const suggestNames = () =>
  call<{ names: string[] }>('/v1/names/suggest').then((r) => r.names);

export const setName = (name: string) =>
  call<Me>('/v1/me/name', { method: 'PUT', body: JSON.stringify({ name }) });

export const board = (mode: string, limit = 25) =>
  call<{ entries: BoardEntry[] }>(`/v1/board/${mode}?limit=${limit}`).then((r) => r.entries);

export const dailyBoard = (limit = 25) =>
  call<{ day: string; seed: string; entries: BoardEntry[] }>(`/v1/board/daily?limit=${limit}`);

export const streakBoard = (limit = 25) =>
  call<{ entries: BoardEntry[] }>(`/v1/board/streaks?limit=${limit}`).then((r) => r.entries);

export interface RunResult {
  accepted: boolean;
  personal_best?: boolean;
  daily_best?: boolean;
  streaks?: Streaks;
  reason?: string;
  message?: string;
}

export interface RunSubmission {
  mode: string;
  score: number;
  duration_ms: number;
  seed: string;
  is_daily: boolean;
  flap_ticks: string;
  playfield_h: number;
  second_wind_used: boolean;
  respawn_used: boolean;
  assist_active: boolean;
  build: string;
}

/** Fire and forget. The local best is already written; this is the board. */
export const submitRun = (run: RunSubmission) =>
  call<RunResult>('/v1/runs', { method: 'POST', body: JSON.stringify(run) });

export const respawns = () => call<{ respawns: number; pay_code: string; pay_url: string }>('/v1/respawns');
export const spendRespawn = () => call<{ respawns: number }>('/v1/respawns/spend', { method: 'POST' });

export const issueRecovery = () => call<{ code: string }>('/v1/recovery/issue', { method: 'POST' });
export const claimRecovery = (code: string) =>
  call<Me & { token: string }>('/v1/recovery/claim', {
    method: 'POST',
    body: JSON.stringify({ code, device_id: load().installId }),
  }).then((r) => { save({ token: r.token, name: r.name, tag: r.tag }); return r; });

export const devices = () => call<{ devices: { device_id: string; last_seen: number }[] }>('/v1/devices');
export const signOutOthers = () =>
  call<{ token: string }>('/v1/devices', { method: 'DELETE' }).then((r) => { save({ token: r.token }); return r; });
