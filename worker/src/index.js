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
//   GET    /v1/devices                                 (auth)
//   DELETE /v1/devices           { device_id }         (auth)
//   GET    /v1/save                                    (auth)
//   PUT    /v1/save          { rev, blob }             (auth)
//   POST   /v1/runs          { mode, score, ... }      (auth)
//   GET    /v1/board/:mode   ?limit=
//   GET    /v1/board/daily   ?day=YYYY-MM-DD
//   GET    /v1/board/streaks ?limit=
//   GET    /v1/respawns                                (auth)
//   POST   /v1/respawns/spend                          (auth)
//   GET    /v1/names/suggest                           (auth)
//   POST   /v1/paystack/webhook  (signed by Paystack, not by a session)

import { json, fail, readJson, corsHeaders, HttpError } from './http.js';
import {
  issueSession, readSession, bearer, verifyGoogleIdToken, cleanName,
  tagFor, mintRecoveryCode, normaliseRecoveryCode, hashRecoveryCode,
} from './auth.js';
import { checkRun, REASONS, maxScoreForDuration } from './bounds.js';
import {
  verifyPaystackSignature, judgeCharge, mintPayCode,
  DEFAULT_MIN_SUBUNITS, RESPAWNS_PER_PAYMENT,
} from './paystack.js';
import { suggestNames } from './names.js';
import { advanceStreak, isAlive, milestoneFor } from './streaks.js';
import { runMaintenance } from './maintenance.js';
import { report as budgetReport } from './budget.js';
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

  /**
   * The hourly cron. Prunes expired rows and records the day's projection, so
   * neither job is ever in a player's latency path.
   */
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil(
      runMaintenance(env.DB)
        .then((r) => console.log('maintenance', JSON.stringify(r)))
        .catch((e) => console.error('maintenance failed', e && e.stack ? e.stack : e)),
    );
  },
};

/**
 * Today's budget row, cached so the shed check is free after the first request.
 *
 * Keyed on the database binding rather than held in a bare module variable: a
 * module-level cache is shared by every database an isolate ever sees, which
 * is wrong in principle and observably wrong under test. The WeakMap also lets
 * the entry be collected with the binding.
 *
 * The 60-second TTL is deliberate. The cron flips `shed` at most once an hour,
 * so a running isolate can serve a stale `false` for up to a minute — which on
 * a 100,000-a-day budget is a rounding error, and the alternative is a read on
 * every request to save writes we were not making anyway.
 */
const OPS_TTL_MS = 60_000;
const opsCache = new WeakMap();

async function opsToday(db, day) {
  const now = Date.now();
  const hit = opsCache.get(db);
  if (hit && hit.day === day && now - hit.at < OPS_TTL_MS) return hit.row;
  const row = await db.prepare('SELECT * FROM ops WHERE day = ?1').bind(day).first();
  opsCache.set(db, { day, row, at: now });
  return row;
}

/**
 * True when the day's projected writes are past 80% of the free-tier limit.
 *
 * Shedding drops writes a player would not notice — reject logging, cloud
 * saves, last-seen touches — and never the ones they would: a score, a
 * personal best, a streak. Degradation, not an outage.
 */
async function shedding(db, day) {
  const row = await opsToday(db, day);
  return Number(row?.shed) === 1;
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);

  if (path === '/v1/health' && method === 'GET') {
    // The budget is one curl away rather than a dashboard hunt.
    const ops = await opsToday(db, todayKey()).catch(() => null);
    return json(
      { ok: true, version: VERSION, day: todayKey(), modes: MODE_ORDER, budget: budgetReport(ops) },
      ctx,
    );
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
      await store.touchDevice(db, deviceId, now);
      await maybeTouch(db, player, now);
    }
    return json({ token: await sessionFor(player, env), player: publicPlayer(player) }, ctx);
  }

  if (path === '/v1/auth/google' && method === 'POST') {
    const body = await readJson(request);
    const { sub, name } = await verifyGoogleIdToken(body.id_token, env);
    const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : '';

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

    // The device signing in joins the account, up to the cap.
    let evicted = null;
    if (DEVICE_ID_RE.test(deviceId)) {
      const r = await store.attachDevice(db, player.id, deviceId, now);
      evicted = r.evicted;
      if (evicted) {
        // Sign the evicted device out for real rather than merely forgetting it.
        await store.bumpEpoch(db, player.id);
        player = await store.getPlayer(db, player.id);
      }
    }
    return json(
      {
        token: await sessionFor(player, env),
        player: publicPlayer(player),
        device_evicted: evicted !== null,
      },
      ctx,
    );
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

  // ---------------------------------------------------------------- respawns
  //
  // Purchases happen on the hosted Paystack page; the webhook below is the
  // only thing that grants a balance. These two routes just read and spend it.

  if (path === '/v1/respawns' && method === 'GET') {
    const player = await requirePlayer(request, env, db, ctx);
    let code = player.pay_code;
    if (!code) {
      // Collisions across 32^8 are vanishingly rare but the index is UNIQUE,
      // so retry rather than 500 on the day one happens.
      for (let i = 0; i < 3 && !code; i++) {
        const candidate = mintPayCode();
        try {
          await store.setPayCode(db, player.id, candidate);
          code = candidate;
        } catch {
          /* unique-index race; mint again */
        }
      }
      if (!code) return fail(500, 'internal', 'Could not assign a payment code.', ctx);
    }
    return json(
      {
        balance: Number(player.respawns) || 0,
        pay_code: code,
        pay_link: env.PAYSTACK_LINK || null,
        per_payment: RESPAWNS_PER_PAYMENT,
        min_kes: Math.ceil((Number(env.RESPAWN_MIN_SUBUNITS) || DEFAULT_MIN_SUBUNITS) / 100),
      },
      ctx,
    );
  }

  if (path === '/v1/respawns/spend' && method === 'POST') {
    const player = await requirePlayer(request, env, db, ctx);
    const ok = await store.spendRespawn(db, player.id);
    const balance = ok ? (Number(player.respawns) || 0) - 1 : Number(player.respawns) || 0;
    if (!ok) return fail(409, 'no_respawns', 'No respawns left.', ctx);
    return json({ ok: true, balance }, ctx);
  }

  // ---------------------------------------------------------------- names

  if (path === '/v1/names/suggest' && method === 'GET') {
    await requirePlayer(request, env, db, ctx);
    return json({ suggestions: await suggestNames(db) }, ctx);
  }

  // ---------------------------------------------------------------- paystack
  //
  // Server-to-server; no CORS, no session. Authentication is the HMAC-SHA512
  // signature over the raw body under the account secret. Respond 200 for
  // anything validly signed — a non-200 makes Paystack retry forever.

  if (path === '/v1/paystack/webhook' && method === 'POST') {
    if (!env.PAYSTACK_SECRET_KEY) {
      return fail(503, 'not_configured', 'Payments are not configured.', ctx);
    }
    const raw = await request.text();
    const signed = await verifyPaystackSignature(
      raw,
      request.headers.get('x-paystack-signature') || '',
      env.PAYSTACK_SECRET_KEY,
    );
    if (!signed) return fail(401, 'bad_signature', 'Signature did not verify.', ctx);

    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return fail(400, 'bad_json', 'Body was not valid JSON.', ctx);
    }
    if (event?.event !== 'charge.success') return json({ ignored: true }, ctx);

    const verdict = judgeCharge(event.data, Number(env.RESPAWN_MIN_SUBUNITS) || DEFAULT_MIN_SUBUNITS);
    if (!verdict.reference) return fail(400, 'no_reference', 'Charge carried no reference.', ctx);

    const player = verdict.code ? await store.findByPayCode(db, verdict.code) : null;
    const status = verdict.status === 'credited' && !player ? 'no_player' : verdict.status;

    const firstTime = await store.recordPayment(db, {
      reference: verdict.reference,
      playerId: player?.id ?? null,
      amount: verdict.amount,
      currency: verdict.currency,
      status,
      rawCode: verdict.raw,
      now,
    });
    if (firstTime && status === 'credited') {
      await store.creditRespawns(db, player.id, RESPAWNS_PER_PAYMENT);
    }
    return json({ received: true, status, duplicate: !firstTime }, ctx);
  }

  // ---------------------------------------------------------------- me
  if (path === '/v1/me' && method === 'GET') {
    const player = await requirePlayer(request, env, db, ctx);
    const bests = await store.getBests(db, player.id);
    const today = todayKey();
    return json(
      {
        player: publicPlayer(player),
        bests,
        streaks: streakPayload(
          store.readStreak(player, 'play'),
          store.readStreak(player, 'daily'),
          today,
          false,
        ),
      },
      ctx,
    );
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
    const devices = await store.listDevices(db, moved.id);
    return json(
      {
        token: await sessionFor(moved, env),
        player: publicPlayer(moved),
        devices: devices.length,
      },
      ctx,
    );
  }

  if (path === '/v1/me' && method === 'DELETE') {
    const player = await requirePlayer(request, env, db, ctx);
    await store.deletePlayer(db, player.id);
    return json({ deleted: true }, ctx);
  }

  // ---------------------------------------------------------------- devices
  //
  // Two per account. The third one in evicts the one used longest ago, and the
  // epoch bump above means the evicted device is signed out, not just dropped.

  if (path === '/v1/devices' && method === 'GET') {
    const player = await requirePlayer(request, env, db, ctx);
    const devices = await store.listDevices(db, player.id);
    const mine = bearerDevice(request);
    return json(
      {
        max: store.MAX_DEVICES,
        devices: devices.map((d) => ({
          // Never echo a device id back in full: it is a bearer-ish handle for
          // guest sign-in. Four characters is enough to tell two phones apart.
          id_hint: String(d.device_id).slice(-4).toUpperCase(),
          this_device: mine === d.device_id,
          first_seen: d.first_seen,
          last_seen: d.last_seen,
        })),
      },
      ctx,
    );
  }

  if (path === '/v1/devices' && method === 'DELETE') {
    const player = await requirePlayer(request, env, db, ctx);
    const body = await readJson(request);
    const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : '';
    if (!DEVICE_ID_RE.test(deviceId)) return fail(400, 'bad_device_id', 'A device id is required.', ctx);
    const removed = await store.detachDevice(db, player.id, deviceId);
    if (!removed) return json({ removed: false }, ctx);

    // The epoch is per-account, so bumping it signs out every device — this one
    // included. Hand the caller a token minted at the NEW epoch so the device
    // doing the removing stays signed in and only the others are kicked.
    await store.bumpEpoch(db, player.id);
    const fresh = await store.getPlayer(db, player.id);
    return json({ removed: true, token: await sessionFor(fresh, env) }, ctx);
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
    // Past 80% of the day's ceiling the window widens tenfold: a save that
    // lands five minutes later costs the player nothing, and the local save is
    // the source of truth regardless.
    const shed = await shedding(db, todayKey());
    const window = shed ? SAVE_MIN_INTERVAL_S * 10 : SAVE_MIN_INTERVAL_S;
    const current = await store.getSave(db, player.id);
    if (current && now - current.updated_at < window && rev > current.rev) {
      return json(
        { rev: current.rev, throttled: true, retry_after: window - (now - current.updated_at) },
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
      respawnUsed: body.respawn_used === true,
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
      if (Number.isInteger(score) && score > (best?.score ?? 0) && !(await shedding(db, day))) {
        await store.logReject(db, { playerId: player.id, mode, score, durationMs, reason: finalReason, now });
      }
      // For too_fast, say what the duration actually supports. A reject a
      // person can act on beats one they can only be annoyed by.
      let message = REASONS[finalReason] || 'Run was not accepted.';
      if (finalReason === 'too_fast') {
        message += ` At ${Math.round(durationMs / 1000)}s the highest possible score is ${maxScoreForDuration(mode, durationMs)}.`;
      }
      return json({ accepted: false, reason: finalReason, message }, { ...ctx, status: 422 });
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

    // Streaks advance on a completed run, at most once per day per kind. The
    // death screen uses `outcome` to decide whether this is a moment worth
    // celebrating or a number to show quietly.
    const play = advanceStreak(store.readStreak(player, 'play'), day);
    if (play.changed) await store.saveStreak(db, player.id, 'play', play);

    let daily = store.readStreak(player, 'daily');
    if (isDaily) {
      daily = advanceStreak(daily, day);
      if (daily.changed) await store.saveStreak(db, player.id, 'daily', daily);
    }

    return json(
      {
        accepted: true,
        personal_best: isPb,
        daily_best: dailyPb,
        streaks: streakPayload(play, daily, day, isDaily),
      },
      ctx,
    );
  }

  // ---------------------------------------------------------------- boards
  if (path === '/v1/board/daily' && method === 'GET') {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '')
      ? url.searchParams.get('day')
      : todayKey();
    const rows = await store.boardDaily(db, day, limitParam(url));
    return json({ day, seed: seedCode(dailySeed(day)), entries: rows.map(entry) }, ctx);
  }

  if (path === '/v1/board/streaks' && method === 'GET') {
    const rows = await store.boardStreaks(db, limitParam(url));
    return json(
      {
        board: 'streaks',
        entries: rows.map((r, i) => ({
          rank: i + 1,
          name: r.name,
          tag: tagFor(r.player_id),
          score: r.score,
          current: r.current,
        })),
      },
      ctx,
    );
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

/**
 * One shape for both /v1/me and /v1/runs so the client never has to reconcile
 * two. `alive` is computed rather than stored: a streak last touched two days
 * ago is still alive while this week's grace is unspent, and the title screen
 * should say so instead of showing a number that is about to vanish.
 */
function streakPayload(play, daily, today, advancedDaily) {
  return {
    play: {
      current: play.current,
      best: play.best,
      alive: isAlive(play, today),
      outcome: play.outcome || null,
      milestone: play.outcome && play.outcome !== 'same_day' ? milestoneFor(play.current) : null,
    },
    daily: {
      current: daily.current,
      best: daily.best,
      alive: isAlive(daily, today),
      outcome: advancedDaily ? daily.outcome || null : null,
      milestone: advancedDaily && daily.outcome !== 'same_day' ? milestoneFor(daily.current) : null,
    },
  };
}


function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    tag: tagFor(p.id),
    guest: !p.google_sub,
    has_recovery_code: !!p.recovery_hash,
    respawns: Number(p.respawns) || 0,
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
/** The caller may name the device it is speaking from, for "this device" hints. */
function bearerDevice(request) {
  const h = request.headers.get('x-dovefall-device') || '';
  return DEVICE_ID_RE.test(h.trim()) ? h.trim() : null;
}


async function maybeTouch(db, player, now) {
  if (now - player.last_seen_at <= LAST_SEEN_STALE_S) return;
  if (await shedding(db, todayKey())) return;   // cosmetic; first to go
  await store.touchLastSeen(db, player.id, now);
}
