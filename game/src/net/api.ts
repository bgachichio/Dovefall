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
/**
 * The link a player sends to a friend.
 *
 * It defaults to the address this copy of the game is being served from, which
 * is the only value that cannot be wrong: on workers.dev today it shares a
 * workers.dev link, and the moment the game answers on gachichio.org it shares
 * that instead, with nothing to rebuild. It was a constant pointing at
 * gachichio.org/dovefallgame — a 404 for everyone the game was shared with,
 * for as long as the DNS move had not happened.
 *
 * VITE_SHARE_URL still wins, for the case where the canonical address and the
 * serving address are genuinely different.
 */
function shareUrl(): string {
  const built = import.meta.env?.VITE_SHARE_URL;
  if (built) return String(built).replace(/\/$/, '');
  if (typeof location === 'undefined') return '';
  return (location.origin + location.pathname).replace(/\/$/, '');
}

export const SHARE_URL = shareUrl();

export interface BoardEntry { rank: number; name: string; tag: string; score: number; at?: number; current?: number; }
export interface Streak {
  current: number;
  best: number;
  alive: boolean;
  /** 'advanced' | 'reset' | 'same_day' — null when nothing changed today. */
  outcome: string | null;
  milestone: string | null;
}
export interface Streaks { play: Streak; daily: Streak }
export interface Me { id: string; name: string; tag: string; respawns: number; streaks?: Streaks; }

/**
 * The Worker's wire shape, which is NOT this client's shape.
 *
 * Every endpoint that returns a player nests it under `player`, and three
 * fields are named differently on the wire than in the game: `suggestions`,
 * `balance` and `pay_link`. Reading the flat names off these responses yields
 * `undefined` — silently, because `undefined` is a valid thing to store.
 *
 * That single mismatch was six visible bugs: the chosen name never saved, the
 * name screen had nothing to suggest, the respawn counter read ♥0 forever, the
 * Paystack button opened about:blank, the leaderboard showed a duplicate "You"
 * row because it could not recognise its own name, and every boot wiped the
 * name again. So the translation happens HERE, once, at the boundary — and
 * `worker/test/contract.test.mjs` pins both halves so neither can drift.
 */
interface WirePlayer { id: string; name: string; tag: string; respawns?: number }

const asMe = (p: WirePlayer, streaks?: Streaks): Me => ({
  id: p.id, name: p.name, tag: p.tag, respawns: Number(p.respawns) || 0, streaks,
});

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
        // Which phone is asking. The server uses it to mark "this device" in
        // the device list and to know which one to KEEP when signing the
        // others out; it is the same id already sent when signing in, so it
        // discloses nothing new.
        'x-dovefall-device': load().installId,
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
  const r = await call<{ token: string; player: WirePlayer }>('/v1/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ device_id: s.installId, name: name || s.name || undefined }),
  });
  const me = asMe(r.player);
  save({ token: r.token, name: me.name, tag: me.tag, respawns: me.respawns });
  return { ...me, token: r.token };
}

export async function me(): Promise<Me> {
  const r = await call<{ player: WirePlayer; streaks?: Streaks }>('/v1/me');
  const m = asMe(r.player, r.streaks);
  save({ name: m.name, tag: m.tag, respawns: m.respawns });
  return m;
}

export const suggestNames = () =>
  call<{ suggestions: string[] }>('/v1/names/suggest').then((r) => r.suggestions ?? []);

export const setName = (name: string) =>
  call<{ player: WirePlayer }>('/v1/me/name', { method: 'PUT', body: JSON.stringify({ name }) })
    .then((r) => {
      const m = asMe(r.player);
      save({ name: m.name, tag: m.tag });
      return m;
    });

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

export interface RespawnInfo {
  respawns: number;
  payCode: string;
  /** null when no payment page is configured — the button must not be shown. */
  payUrl: string | null;
  perPayment: number;
  minKes: number;
}

export const respawns = (): Promise<RespawnInfo> =>
  call<{ balance: number; pay_code: string; pay_link: string | null; per_payment: number; min_kes: number }>(
    '/v1/respawns',
  ).then((r) => {
    save({ respawns: Number(r.balance) || 0 });
    return {
      respawns: Number(r.balance) || 0,
      payCode: r.pay_code,
      payUrl: r.pay_link || null,
      perPayment: Number(r.per_payment) || 3,
      minKes: Number(r.min_kes) || 50,
    };
  });

export const spendRespawn = () =>
  call<{ ok: boolean; balance: number }>('/v1/respawns/spend', { method: 'POST' })
    .then((r) => {
      const respawns = Number(r.balance) || 0;
      save({ respawns });
      return { respawns };
    });

export const issueRecovery = () => call<{ code: string }>('/v1/recovery/issue', { method: 'POST' });
export const claimRecovery = (code: string) =>
  call<{ token: string; player: WirePlayer }>('/v1/recovery/claim', {
    method: 'POST',
    body: JSON.stringify({ code, device_id: load().installId }),
  }).then((r) => {
    const m = asMe(r.player);
    save({ token: r.token, name: m.name, tag: m.tag, respawns: m.respawns });
    return m;
  });

export const devices = () => call<{ devices: { device_id: string; last_seen: number }[] }>('/v1/devices');
/** The Worker signs out every device by bumping the account epoch, then hands
 *  back a token minted at the new one — so this phone stays in and the others
 *  do not. Without storing it, the caller signs ITSELF out. */
export const signOutOthers = () =>
  call<{ removed: boolean; count: number; token?: string }>('/v1/devices', { method: 'DELETE' })
    .then((r) => { if (r.token) save({ token: r.token }); return r; });
