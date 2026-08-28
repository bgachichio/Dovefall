// Dovefall API — a single Cloudflare Worker.
//
// Everything here is O(1) plus a query or two: the free plan allows 10 ms of
// CPU per invocation, which is generous for this but not for anything clever.
//
// Routes
//   GET    /v1/health
//   POST   /v1/auth/guest    { device_id }
//   POST   /v1/auth/google   { id_token }
//   POST   /v1/auth/link     { id_token }              (auth)
//   GET    /v1/me                                      (auth)
//   DELETE /v1/me                                      (auth)
//   PUT    /v1/me/name           { name }              (auth)
//   POST   /v1/recovery/issue                          (auth)
//   POST   /v1/recovery/claim    { code, device_id }
//   GET    /v1/save                                    (auth)
//   PUT    /v1/save          { rev, blob }             (auth)
//   POST   /v1/runs          { mode, score, ... }      (auth)
//   GET    /v1/board/:mode   ?limit=
//   GET    /v1/board/daily   ?day=YYYY-MM-DD

import { json, fail, readJson, corsHeaders, HttpError } from './http.js';
import {
  issueSession, readSession, bearer, verifyGoogleIdToken, cleanName,
  tagFor, mintRecoveryCode, normaliseRecoveryCode, hashRecoveryCode,
} from './auth.js';
import { checkRun, REASONS } from './bounds.js';
import { isMode, MODE_ORDER } from './config.js';
import { todayKey, dailySeed, parseSeedCode, seedCode } from './rng.js';
import * as store from './store.js';

const VERSION = '1.0.0';
const MAX_SAVE_BYTES = 8 * 1024;
const MAX_FLAP_TICKS_BYTES = 4 * 1024;
const SAVE_MIN_INTERVAL_S = 30;
const LAST_SEEN_STALE_S = 86400;
const DEVICE_ID_RE = /^[0-9a-fA-F-]{16,64}$/;

export default {
  async fetch(request, env, ctx) {
    const context = { request, env };
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }
      if (!env.DB) return fail(500, 'not_configured', 'Database binding is missing.', context);
      if (!env.SESSION_SECRET) {
        return fail(500, 'not_configured', 'Session secret is not set.', context);
      }
      return await route(request, env, context);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.code, err.message, context);
      console.error('unhandled', err && err.stack ? err.stack : err);
      return fail(500, 'internal', 'Something went wrong on our side.', context);
    }
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);

  if (path === '/v1/health' && method === 'GET') {
    return json({ ok: true, version: VERSION, day: todayKey(), modes: MODE_ORDER }, ctx);
  }

  // ---------------------------------------------------------------- auth
  if (path === '/v1/auth/guest' && method === 'POST') {
    const body = await readJson(request);
    const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : '';
    if (!DEVICE_ID_RE.test(deviceId)) {
      return fail(400, 'bad_device_id', 'A device id is required.', ctx);
    }
    let player = await store.findByDeviceId(db, deviceId);
    if (!player) {
      player = await store.createPlayer(db, {
        id: crypto.randomUUID(),
        deviceId,
        name: cleanName(body.name),
        now,
      });
    } else {
      await maybeTouch(db, player, now);
    }
    return json({ token: await sessionFor(player, env), player: publicPlayer(player) }, ctx);
  }

  if (path === '/v1/auth/google' && method === 'POST') {
    const body = await readJson(request);
    const { sub, name } = await verifyGoogleIdToken(body.id_token, env);
    let player = await store.findByGoogleSub(db, sub);
    if (!player) {
      player = await store.createPlayer(db, {
        id: crypto.randomUUID(),
        googleSub: sub,
        name: cleanName(name),
        now,
      });
    } else {
      await maybeTouch(db, player, now);
    }
    return json({ token: await sessionFor(player, env), player: publicPlayer(player) }, ctx);
  }

  if (path === '/v1/auth/link' && method === 'POST') {
    const player = await requirePlayer(request, env, db, ctx);
    const body = await readJson(request);
    const { sub, name } = await verifyGoogleIdToken(body.id_token, env);

    const existing = await store.findByGoogleSub(db, sub);
    if (existing && existing.id !== player.id) {
      // The Google account already owns a player. Rather than merge two score
      // histories — which would need a rule for whose best wins, and is a good
      // way to lose someone's record — hand back the established account.
      return json(
        {
          token: await sessionFor(existing, env),
          player: publicPlayer(existing),
          merged: false,
          note: 'This Google account already has progress. Signed in to it.',
        },
        ctx,
      );
    }
    if (player.google_sub) {
      return fail(409, 'already_linked', 'This player is already signed in.', ctx);
    }
    const linked = await store.linkGoogle(db, player.id, sub, cleanName(name, player.name));
    return json({ player: publicPlayer(linked), merged: true }, ctx);
  }

  // ---------------------------------------------------------------- me
  if (path === '/v1/me' && method === 'GET') {
    const player = await requirePlayer(request, env, db, ctx);
    const bests = await store.getBests(db, player.id);
    return json({ player: publicPlayer(player), bests }, ctx);
  }

  if (path === '/v1/me/name' && method === 'PUT') {
    const player = await requirePlayer(request, env, db, ctx);
    const body = await readJson(request);
    const name = cleanName(body.name, '');
    if (name === '') {
      return fail(400, 'bad_name', 'Pick a name with at least one visible character.', ctx);
    }
    await store.setName(db, player.id, name);
    return json({ player: publicPlayer({ ...player, name }) }, ctx);
  }

  // ---------------------------------------------------------------- recovery
  //
  // The email-free answer to "I got a new phone". The player writes the code
  // down; we keep only its hash, so a copy of this database does not let anyone
  // take over an account.

  if (path === '/v1/recovery/issue' && method === 'POST') {
    const player = await requirePlayer(request, env, db, ctx);
    const code = mintRecoveryCode();
    await store.setRecovery(db, player.id, await hashRecoveryCode(normaliseRecoveryCode(code)), now);
    return json(
      {
        code,
        note: 'Write this down. It is shown once, works once, and is the only way '
          + 'back into this account on a new device.',
      },
      ctx,
    );
  }

  if (path === '/v1/recovery/claim' && method === 'POST') {
    const body = await readJson(request);
    const normalised = normaliseRecoveryCode(body.code);
    const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : '';

    if (!normalised) return fail(400, 'bad_code', 'That does not look like a recovery code.', ctx);
    if (!DEVICE_ID_RE.test(deviceId)) return fail(400, 'bad_device_id', 'A device id is required.', ctx);

    const found = await store.findByRecoveryHash(db, await hashRecoveryCode(normalised));
    if (!found) {
      return fail(404, 'no_such_code', 'That code is not valid. A code works only once.', ctx);
    }

    const moved = await store.claimRecovery(db, found, deviceId, now);
    return json({ token: await sessionFor(moved, env), player: publicPlayer(moved) }, ctx);
  }

  if (path === '/v1/me' && method === 'DELETE') {
    const player = await requirePlayer(request, env, db, ctx);
    await store.deletePlayer(db, player.id);
    return json({ deleted: true }, ctx);
  }

  // ---------------------------------------------------------------- save
  if (path === '/v1/save' && method === 'GET') {
    const player = await requirePlayer(request, env, db, ctx);
    const save = await store.getSave(db, player.id);
    return json({ rev: save?.rev ?? 0, blob: save?.blob ?? null }, ctx);
  }

  if (path === '/v1/save' && method === 'PUT') {
    const player = await requirePlayer(request, env, db, ctx);
    const body = await readJson(request, MAX_SAVE_BYTES + 1024);
    const rev = Number(body.rev);
    const blob = body.blob;

    if (!Number.isInteger(rev) || rev < 1) return fail(400, 'bad_rev', 'Revision must be a positive integer.', ctx);
    if (typeof blob !== 'string' || blob.length === 0) {
      return fail(400, 'bad_blob', 'Save payload is required.', ctx);
    }
    if (blob.length > MAX_SAVE_BYTES) {
      return fail(413, 'save_too_large', `Save must be under ${MAX_SAVE_BYTES} bytes.`, ctx);
    }

    // Writes are the scarce resource on the free plan, so a client that syncs
    // too eagerly is asked to wait rather than silently burning the budget.
    const current = await store.getSave(db, player.id);
    if (current && now - current.updated_at < SAVE_MIN_INTERVAL_S && rev > current.rev) {
      return json(
        { rev: current.rev, throttled: true, retry_after: SAVE_MIN_INTERVAL_S - (now - current.updated_at) },
        { ...ctx, status: 429 },
      );
    }

    const written = await store.putSave(db, player.id, rev, blob, now);
    return json({ rev: written ? rev : current?.rev ?? 0, stored: written }, ctx);
  }

  // ---------------------------------------------------------------- runs
  if (path === '/v1/runs' && method === 'POST') {
    const player = await requirePlayer(request, env, db, ctx);
    if (player.banned) return fail(403, 'banned', 'This account cannot submit scores.', ctx);

    const body = await readJson(request);
    const mode = String(body.mode || '');
    const score = Number(body.score);
    const durationMs = Number(body.duration_ms);
    const isDaily = body.is_daily === true;
    const flapTicks = typeof body.flap_ticks === 'string' ? body.flap_ticks : null;
    const playfieldH = Number.isInteger(body.playfield_h) ? body.playfield_h : null;
    const build = typeof body.build === 'string' ? body.build.slice(0, 32) : null;

    if (!isMode(mode)) return fail(400, 'bad_mode', REASONS.bad_mode, ctx);
    if (flapTicks && flapTicks.length > MAX_FLAP_TICKS_BYTES) {
      return fail(413, 'replay_too_large', 'Replay log is too large.', ctx);
    }

    const reason = checkRun({
      mode,
      score,
      durationMs,
      secondWindUsed: body.second_wind_used === true,
      assistActive: body.assist_active === true,
    });

    // A daily run must have used the day's seed. Free to check, and it catches
    // anyone posting a lucky practice run to the daily board.
    const day = todayKey();
    const submittedSeed = parseSeedCode(body.seed);
    let dailyReason = null;
    if (!reason && isDaily) {
      if (submittedSeed !== dailySeed(day)) dailyReason = 'wrong_daily_seed';
    }
    const finalReason = reason || dailyReason;

    if (finalReason) {
      // Only worth a write if this was an attempt on the board, rather than a
      // confused client posting an ordinary run.
      const best = await store.getBest(db, player.id, mode);
      if (Number.isInteger(score) && score > (best?.score ?? 0)) {
        await store.logReject(db, { playerId: player.id, mode, score, durationMs, reason: finalReason, now });
      }
      return json(
        { accepted: false, reason: finalReason, message: REASONS[finalReason] || 'Run was not accepted.' },
        { ...ctx, status: 422 },
      );
    }

    const seed = submittedSeed ? seedCode(submittedSeed) : null;
    const isPb = await store.upsertBest(db, {
      playerId: player.id, mode, score, seed, durationMs,
      flapTicks, playfieldH, build, now,
    });

    let dailyPb = false;
    if (isDaily) {
      dailyPb = await store.upsertDaily(db, {
        day, playerId: player.id, score, durationMs, flapTicks, playfieldH, now,
      });
    }

    return json({ accepted: true, personal_best: isPb, daily_best: dailyPb }, ctx);
  }

  // ---------------------------------------------------------------- boards
  if (path === '/v1/board/daily' && method === 'GET') {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '')
      ? url.searchParams.get('day')
      : todayKey();
    const rows = await store.boardDaily(db, day, limitParam(url));
    return json({ day, seed: seedCode(dailySeed(day)), entries: rows.map(entry) }, ctx);
  }

  const boardMatch = path.match(/^\/v1\/board\/([a-z]+)$/);
  if (boardMatch && method === 'GET') {
    const mode = boardMatch[1];
    if (!isMode(mode)) return fail(404, 'bad_mode', REASONS.bad_mode, ctx);
    const rows = await store.boardAllTime(db, mode, limitParam(url));
    return json({ mode, entries: rows.map(entry) }, ctx);
  }

  return fail(404, 'not_found', 'No such endpoint.', ctx);
}

// -------------------------------------------------------------------- helpers

function limitParam(url) {
  const n = Number(url.searchParams.get('limit'));
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 50;
}

/** Boards are public, so they carry a display name and a score and nothing else. */
function entry(row, i) {
  return { rank: i + 1, name: row.name, tag: tagFor(row.player_id), score: row.score, at: row.achieved_at };
}

function sessionFor(player, env) {
  return issueSession(player.id, env, Number(player.session_epoch) || 1);
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    tag: tagFor(p.id),
    guest: !p.google_sub,
    has_recovery_code: !!p.recovery_hash,
    created_at: p.created_at,
  };
}

async function requirePlayer(request, env, db, ctx) {
  const session = await readSession(bearer(request), env);
  if (!session) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  const player = await store.getPlayer(db, session.playerId);
  if (!player) throw new HttpError(401, 'unknown_player', 'This session is no longer valid.');
  if (session.epoch !== (Number(player.session_epoch) || 1)) {
    throw new HttpError(401, 'session_superseded', 'This account was restored on another device.');
  }
  return player;
}

/** One write per player per day at most, rather than one per request. */
async function maybeTouch(db, player, now) {
  if (now - player.last_seen_at > LAST_SEEN_STALE_S) {
    await store.touchLastSeen(db, player.id, now);
  }
}
