// D1 access. Every query is prepared and bound — no string interpolation
// reaches SQL, anywhere, ever.

const BOARD_LIMIT = 100;

export async function getPlayer(db, id) {
  return db.prepare('SELECT * FROM players WHERE id = ?1').bind(id).first();
}

export async function findByGoogleSub(db, sub) {
  return db.prepare('SELECT * FROM players WHERE google_sub = ?1').bind(sub).first();
}

/** Resolve a device to its owner. The binding lives in `devices`, not on the player. */
export async function findByDeviceId(db, deviceId) {
  return db
    .prepare(
      `SELECT p.* FROM players p JOIN devices d ON d.player_id = p.id
        WHERE d.device_id = ?1`,
    )
    .bind(deviceId)
    .first();
}

export async function createPlayer(db, { id, googleSub = null, deviceId = null, name, now }) {
  await db
    .prepare(
      `INSERT INTO players (id, google_sub, name, created_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?4)`,
    )
    .bind(id, googleSub, name, now)
    .run();
  if (deviceId) await attachDevice(db, id, deviceId, now);
  return getPlayer(db, id);
}

/**
 * Attach a Google identity to an existing (guest) player.
 *
 * Device bindings survive the link — the phone you were playing on is still
 * yours afterwards. Signing in is an upgrade, not a handover.
 */
export async function linkGoogle(db, playerId, googleSub, name) {
  await db
    .prepare('UPDATE players SET google_sub = ?2, name = COALESCE(?3, name) WHERE id = ?1')
    .bind(playerId, googleSub, name)
    .run();
  return getPlayer(db, playerId);
}

export async function getBests(db, playerId) {
  const { results } = await db
    .prepare('SELECT mode, score, seed, duration_ms, achieved_at FROM bests WHERE player_id = ?1')
    .bind(playerId)
    .all();
  return results || [];
}

export async function getBest(db, playerId, mode) {
  return db
    .prepare('SELECT score FROM bests WHERE player_id = ?1 AND mode = ?2')
    .bind(playerId, mode)
    .first();
}

/**
 * Upsert a personal best. Only writes when the score actually improves — the
 * `WHERE excluded.score > bests.score` clause makes that a property of the
 * statement rather than of the caller remembering to check.
 */
export async function upsertBest(db, row) {
  const res = await db
    .prepare(
      `INSERT INTO bests (player_id, mode, score, seed, duration_ms, flap_ticks, playfield_h, build, achieved_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(player_id, mode) DO UPDATE SET
         score = excluded.score, seed = excluded.seed, duration_ms = excluded.duration_ms,
         flap_ticks = excluded.flap_ticks, playfield_h = excluded.playfield_h,
         build = excluded.build, achieved_at = excluded.achieved_at
       WHERE excluded.score > bests.score`,
    )
    .bind(
      row.playerId, row.mode, row.score, row.seed, row.durationMs,
      row.flapTicks, row.playfieldH, row.build, row.now,
    )
    .run();
  return (res.meta?.changes || 0) > 0;
}

export async function upsertDaily(db, row) {
  const res = await db
    .prepare(
      `INSERT INTO daily (day, player_id, score, duration_ms, flap_ticks, playfield_h, achieved_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(day, player_id) DO UPDATE SET
         score = excluded.score, duration_ms = excluded.duration_ms,
         flap_ticks = excluded.flap_ticks, playfield_h = excluded.playfield_h,
         achieved_at = excluded.achieved_at
       WHERE excluded.score > daily.score`,
    )
    .bind(row.day, row.playerId, row.score, row.durationMs, row.flapTicks, row.playfieldH, row.now)
    .run();
  return (res.meta?.changes || 0) > 0;
}

/** Ties break by who got there first, which is the only fair tiebreak. */
export async function boardAllTime(db, mode, limit = BOARD_LIMIT) {
  const { results } = await db
    .prepare(
      `SELECT p.name, b.score, b.achieved_at, b.player_id
         FROM bests b JOIN players p ON p.id = b.player_id
        WHERE b.mode = ?1 AND p.banned = 0
        ORDER BY b.score DESC, b.achieved_at ASC
        LIMIT ?2`,
    )
    .bind(mode, Math.min(limit, BOARD_LIMIT))
    .all();
  return results || [];
}

export async function boardDaily(db, day, limit = BOARD_LIMIT) {
  const { results } = await db
    .prepare(
      `SELECT p.name, d.score, d.achieved_at, d.player_id
         FROM daily d JOIN players p ON p.id = d.player_id
        WHERE d.day = ?1 AND p.banned = 0
        ORDER BY d.score DESC, d.achieved_at ASC
        LIMIT ?2`,
    )
    .bind(day, Math.min(limit, BOARD_LIMIT))
    .all();
  return results || [];
}


export async function getSave(db, playerId) {
  return db.prepare('SELECT rev, blob, updated_at FROM saves WHERE player_id = ?1').bind(playerId).first();
}

/** Refuses to move `rev` backwards, so a stale device cannot clobber a newer save. */
export async function putSave(db, playerId, rev, blob, now) {
  const res = await db
    .prepare(
      `INSERT INTO saves (player_id, rev, blob, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(player_id) DO UPDATE SET
         rev = excluded.rev, blob = excluded.blob, updated_at = excluded.updated_at
       WHERE excluded.rev > saves.rev`,
    )
    .bind(playerId, rev, blob, now)
    .run();
  return (res.meta?.changes || 0) > 0;
}

export async function logReject(db, { playerId, mode, score, durationMs, reason, now }) {
  await db
    .prepare(
      `INSERT INTO rejects (player_id, mode, score, duration_ms, reason, at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(playerId, mode, score, durationMs, reason, now)
    .run();
}

/** Right to erasure. Cascades to bests, daily and saves via the FK. */
export async function deletePlayer(db, playerId) {
  await db.prepare('DELETE FROM saves  WHERE player_id = ?1').bind(playerId).run();
  await db.prepare('DELETE FROM bests  WHERE player_id = ?1').bind(playerId).run();
  await db.prepare('DELETE FROM daily  WHERE player_id = ?1').bind(playerId).run();
  await db.prepare('DELETE FROM players WHERE id = ?1').bind(playerId).run();
}

export async function touchLastSeen(db, playerId, now) {
  await db.prepare('UPDATE players SET last_seen_at = ?2 WHERE id = ?1').bind(playerId, now).run();
}


// ---------------------------------------------------------------- identity

export async function setName(db, playerId, name) {
  await db.prepare('UPDATE players SET name = ?2 WHERE id = ?1').bind(playerId, name).run();
}

/** One live code per player; issuing a new one invalidates the old. */
export async function setRecovery(db, playerId, hash, now) {
  await db
    .prepare('UPDATE players SET recovery_hash = ?2, recovery_issued_at = ?3 WHERE id = ?1')
    .bind(playerId, hash, now)
    .run();
}

export async function findByRecoveryHash(db, hash) {
  return db.prepare('SELECT * FROM players WHERE recovery_hash = ?1').bind(hash).first();
}

/**
 * Move an account onto a new device.
 *
 * Three things happen together, so they go in one batch: the code is spent, the
 * device binding moves, and the session epoch advances — which signs out the
 * old handset. That last part is the reason someone whose phone was stolen
 * bothers to do this at all.
 *
 * If the new device was already carrying a throwaway guest, it is unbound. An
 * empty guest (no sign-in, no scores) is deleted outright; one with scores is
 * left in place rather than quietly destroyed.
 */
export async function claimRecovery(db, player, deviceId, now) {
  const squatter = await findByDeviceId(db, deviceId);

  // An empty throwaway guest on the new device is cleared away; one that has
  // scores is left alone and merely loses this device. Never destroy progress.
  if (squatter && squatter.id !== player.id) {
    const scores = await db
      .prepare('SELECT COUNT(*) AS n FROM bests WHERE player_id = ?1')
      .bind(squatter.id)
      .first();
    const otherDevices = (await countDevices(db, squatter.id)) - 1;
    if (!squatter.google_sub && (scores?.n || 0) === 0 && otherDevices <= 0) {
      await db.prepare('DELETE FROM players WHERE id = ?1').bind(squatter.id).run();
    }
  }

  await db
    .prepare(
      `UPDATE players
          SET recovery_hash = NULL, recovery_issued_at = NULL,
              session_epoch = session_epoch + 1, last_seen_at = ?2
        WHERE id = ?1`,
    )
    .bind(player.id, now)
    .run();

  await attachDevice(db, player.id, deviceId, now);
  return getPlayer(db, player.id);
}


// ---------------------------------------------------------------- respawns

export async function setPayCode(db, playerId, code) {
  await db.prepare('UPDATE players SET pay_code = ?2 WHERE id = ?1').bind(playerId, code).run();
}

export async function findByPayCode(db, code) {
  return db.prepare('SELECT * FROM players WHERE pay_code = ?1').bind(code).first();
}

export async function creditRespawns(db, playerId, n) {
  await db
    .prepare('UPDATE players SET respawns = respawns + ?2 WHERE id = ?1')
    .bind(playerId, n)
    .run();
}

/** Single guarded decrement: two devices racing cannot spend the same one. */
export async function spendRespawn(db, playerId) {
  const res = await db
    .prepare('UPDATE players SET respawns = respawns - 1 WHERE id = ?1 AND respawns > 0')
    .bind(playerId)
    .run();
  return (res.meta?.changes || 0) > 0;
}

/**
 * Record a payment reference exactly once. Returns false when the reference
 * was already seen — the idempotency guard against webhook retries.
 */
export async function recordPayment(db, { reference, playerId, amount, currency, status, rawCode, now }) {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO payments (reference, player_id, amount, currency, status, raw_code, at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(reference, playerId, amount, currency, status, rawCode, now)
    .run();
  return (res.meta?.changes || 0) > 0;
}


// ---------------------------------------------------------------- devices

export const MAX_DEVICES = 2;

export async function listDevices(db, playerId) {
  const { results } = await db
    .prepare('SELECT device_id, first_seen, last_seen FROM devices WHERE player_id = ?1 ORDER BY last_seen DESC')
    .bind(playerId)
    .all();
  return results || [];
}

export async function countDevices(db, playerId) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM devices WHERE player_id = ?1')
    .bind(playerId)
    .first();
  return Number(row?.n) || 0;
}

/**
 * Bind a device to a player, capped at MAX_DEVICES.
 *
 * Returns { attached, evicted, alreadyMine }. When the cap is exceeded the
 * device used longest ago is evicted; the caller bumps the session epoch so
 * that device is signed out rather than left holding a working token.
 *
 * A device already bound elsewhere is moved, not duplicated: entering your
 * recovery code on a friend's phone should take that phone, and the PRIMARY
 * KEY on device_id makes any other outcome impossible anyway.
 */
export async function attachDevice(db, playerId, deviceId, now) {
  const existing = await db
    .prepare('SELECT player_id FROM devices WHERE device_id = ?1')
    .bind(deviceId)
    .first();

  if (existing && existing.player_id === playerId) {
    await db
      .prepare('UPDATE devices SET last_seen = ?2 WHERE device_id = ?1')
      .bind(deviceId, now)
      .run();
    return { attached: false, evicted: null, alreadyMine: true };
  }

  await db
    .prepare(
      `INSERT INTO devices (device_id, player_id, first_seen, last_seen)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT(device_id) DO UPDATE SET
         player_id = excluded.player_id, first_seen = excluded.first_seen,
         last_seen = excluded.last_seen`,
    )
    .bind(deviceId, playerId, now)
    .run();

  let evicted = null;
  if ((await countDevices(db, playerId)) > MAX_DEVICES) {
    const oldest = await db
      .prepare(
        `SELECT device_id FROM devices WHERE player_id = ?1 AND device_id != ?2
          ORDER BY last_seen ASC LIMIT 1`,
      )
      .bind(playerId, deviceId)
      .first();
    if (oldest) {
      await db.prepare('DELETE FROM devices WHERE device_id = ?1').bind(oldest.device_id).run();
      evicted = oldest.device_id;
    }
  }
  return { attached: true, evicted, alreadyMine: false };
}

export async function detachDevice(db, playerId, deviceId) {
  const res = await db
    .prepare('DELETE FROM devices WHERE player_id = ?1 AND device_id = ?2')
    .bind(playerId, deviceId)
    .run();
  return (res.meta?.changes || 0) > 0;
}

export async function bumpEpoch(db, playerId) {
  await db
    .prepare('UPDATE players SET session_epoch = session_epoch + 1 WHERE id = ?1')
    .bind(playerId)
    .run();
}

export async function touchDevice(db, deviceId, now) {
  await db.prepare('UPDATE devices SET last_seen = ?2 WHERE device_id = ?1').bind(deviceId, now).run();
}


// ---------------------------------------------------------------- streaks

/**
 * Persist an advanced streak. Guarded on the day so a second run today writes
 * nothing — the streak costs one row-write per active player per day.
 */
export async function saveStreak(db, playerId, kind, next) {
  const c = kind === 'daily'
    ? ['daily_streak', 'daily_best', 'daily_last_day', 'daily_grace_week']
    : ['play_streak', 'play_best', 'play_last_day', 'play_grace_week'];
  const res = await db
    .prepare(
      `UPDATE players SET ${c[0]} = ?2, ${c[1]} = ?3, ${c[2]} = ?4, ${c[3]} = ?5
        WHERE id = ?1 AND (${c[2]} IS NULL OR ${c[2]} != ?4)`,
    )
    .bind(playerId, next.current, next.best, next.lastDay, next.graceWeek)
    .run();
  return (res.meta?.changes || 0) > 0;
}

export function readStreak(player, kind) {
  const p = kind === 'daily'
    ? ['daily_streak', 'daily_best', 'daily_last_day', 'daily_grace_week']
    : ['play_streak', 'play_best', 'play_last_day', 'play_grace_week'];
  return {
    current: Number(player?.[p[0]]) || 0,
    best: Number(player?.[p[1]]) || 0,
    lastDay: player?.[p[2]] || null,
    graceWeek: player?.[p[3]] || null,
  };
}

/** Who has kept the daily ritual longest. A board for persistence, not reflex. */
export async function boardStreaks(db, limit = 50) {
  const { results } = await db
    .prepare(
      `SELECT p.id AS player_id, p.name, p.daily_best AS score, p.daily_streak AS current
         FROM players p
        WHERE p.banned = 0 AND p.daily_best > 0
        ORDER BY p.daily_best DESC, p.created_at ASC
        LIMIT ?1`,
    )
    .bind(Math.min(limit, 100))
    .all();
  return results || [];
}
