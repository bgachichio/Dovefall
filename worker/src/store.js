// D1 access. Every query is prepared and bound — no string interpolation
// reaches SQL, anywhere, ever.

const BOARD_LIMIT = 100;

export async function getPlayer(db, id) {
  return db.prepare('SELECT * FROM players WHERE id = ?1').bind(id).first();
}

export async function findByGoogleSub(db, sub) {
  return db.prepare('SELECT * FROM players WHERE google_sub = ?1').bind(sub).first();
}

export async function findByDeviceId(db, deviceId) {
  return db.prepare('SELECT * FROM players WHERE device_id = ?1').bind(deviceId).first();
}

export async function createPlayer(db, { id, googleSub = null, deviceId = null, name, now }) {
  await db
    .prepare(
      `INSERT INTO players (id, google_sub, device_id, name, created_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    )
    .bind(id, googleSub, deviceId, name, now)
    .run();
  return getPlayer(db, id);
}

/**
 * Attach a Google identity to an existing (guest) player.
 *
 * The device_id is cleared on link, so the guest handle cannot later be used to
 * re-enter an account that now has a real owner.
 */
export async function linkGoogle(db, playerId, googleSub, name) {
  await db
    .prepare(
      `UPDATE players SET google_sub = ?2, device_id = NULL, name = COALESCE(?3, name)
       WHERE id = ?1`,
    )
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

export async function rankAllTime(db, mode, score) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM bests b JOIN players p ON p.id = b.player_id
        WHERE b.mode = ?1 AND p.banned = 0 AND b.score > ?2`,
    )
    .bind(mode, score)
    .first();
  return (row?.n || 0) + 1;
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
  const statements = [];

  if (squatter && squatter.id !== player.id) {
    const scores = await db
      .prepare('SELECT COUNT(*) AS n FROM bests WHERE player_id = ?1')
      .bind(squatter.id)
      .first();
    const empty = !squatter.google_sub && (scores?.n || 0) === 0;
    statements.push(
      empty
        ? db.prepare('DELETE FROM players WHERE id = ?1').bind(squatter.id)
        : db.prepare('UPDATE players SET device_id = NULL WHERE id = ?1').bind(squatter.id),
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE players
            SET device_id = ?2, recovery_hash = NULL, recovery_issued_at = NULL,
                session_epoch = session_epoch + 1, last_seen_at = ?3
          WHERE id = ?1`,
      )
      .bind(player.id, deviceId, now),
  );

  await db.batch(statements);
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
