// The hourly cron: prune what has expired, measure what remains, decide
// whether to shed.
//
// Runs on a schedule, not on a request, so none of this is ever in a player's
// latency path. Every DELETE is bounded by a LIMIT so a single run can never
// blow the write budget while trying to protect it — a runaway cleanup would
// be exactly the failure it exists to prevent.

import { RETENTION_DAYS, projectDaily, shouldShed, LIMITS } from './budget.js';
import { todayKey } from './rng.js';

/** Never delete more than this in one run; the next hour picks up the rest. */
const MAX_DELETES_PER_RUN = 2000;

function daysAgoUnix(days, now) {
  return now - days * 86400;
}

/**
 * Delete expired rows, bounded.
 *
 * Every statement is `WHERE rowid IN (SELECT rowid ... LIMIT n)` rather than a
 * bare DELETE with LIMIT: SQLite only supports the latter when compiled with
 * SQLITE_ENABLE_UPDATE_DELETE_LIMIT, which is not a thing to bet a nightly job
 * on. The subquery form works everywhere and reads no worse.
 */
export async function prune(db, now) {
  const jobs = [
    // `bests` is never pruned: a personal best is the whole point of the game.
    ['daily',    'DELETE FROM daily WHERE rowid IN (SELECT rowid FROM daily WHERE day < ?1 LIMIT ?2)',
      dayKeyDaysAgo(RETENTION_DAYS.daily, now)],
    ['rejects',  'DELETE FROM rejects WHERE rowid IN (SELECT rowid FROM rejects WHERE at < ?1 LIMIT ?2)',
      daysAgoUnix(RETENTION_DAYS.rejects, now)],
    ['payments', 'DELETE FROM payments WHERE rowid IN (SELECT rowid FROM payments WHERE at < ?1 LIMIT ?2)',
      daysAgoUnix(RETENTION_DAYS.payments, now)],
    ['ops',      'DELETE FROM ops WHERE rowid IN (SELECT rowid FROM ops WHERE day < ?1 LIMIT ?2)',
      dayKeyDaysAgo(RETENTION_DAYS.ops, now)],
  ];

  let budget = MAX_DELETES_PER_RUN;
  const removed = {};

  for (const [name, sql, cutoff] of jobs) {
    if (budget <= 0) break;
    const res = await db.prepare(sql).bind(cutoff, budget).run();
    const n = Number(res?.meta?.changes) || 0;
    if (n > 0) removed[name] = n;
    budget -= n;
  }

  // Rows orphaned by an older schema or a partial failure. The foreign keys
  // cascade on a normal delete, so this is usually zero — cheap insurance.
  const orphans = [
    ['orphan_devices', 'DELETE FROM devices WHERE rowid IN (SELECT d.rowid FROM devices d LEFT JOIN players p ON p.id = d.player_id WHERE p.id IS NULL LIMIT ?1)'],
    ['orphan_saves',   'DELETE FROM saves   WHERE rowid IN (SELECT s.rowid FROM saves   s LEFT JOIN players p ON p.id = s.player_id WHERE p.id IS NULL LIMIT ?1)'],
  ];
  for (const [name, sql] of orphans) {
    if (budget <= 0) break;
    const res = await db.prepare(sql).bind(budget).run();
    const n = Number(res?.meta?.changes) || 0;
    if (n > 0) removed[name] = n;
    budget -= n;
  }

  return removed;
}

function dayKeyDaysAgo(days, nowUnix) {
  return new Date((nowUnix - days * 86400) * 1000).toISOString().slice(0, 10);
}

/**
 * Count what was written today, by timestamp, and record the projection.
 *
 * Reads are the abundant budget, so counting is cheap; the single INSERT is
 * the only write this performs.
 */
export async function measure(db, now) {
  const day = todayKey(new Date(now * 1000));
  const midnight = Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
  const hoursElapsed = Math.max(0, (now - midnight) / 3600);

  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM players WHERE created_at   >= ?1) AS new_players,
         (SELECT COUNT(*) FROM bests   WHERE achieved_at  >= ?1) AS bests,
         (SELECT COUNT(*) FROM daily   WHERE achieved_at  >= ?1) AS daily,
         (SELECT COUNT(*) FROM saves   WHERE updated_at   >= ?1) AS saves,
         (SELECT COUNT(*) FROM rejects WHERE at           >= ?1) AS rejects,
         (SELECT COUNT(*) FROM payments WHERE at          >= ?1) AS payments,
         (SELECT COUNT(*) FROM players)  AS total_players,
         (SELECT COUNT(*) FROM bests)    AS total_bests,
         (SELECT COUNT(*) FROM daily)    AS total_daily`,
    )
    .bind(midnight)
    .first();

  // Each logical write touches the table plus any index covering a written
  // column, so the row count understates the billed rows. Two is the honest
  // multiplier for this schema (bests and daily each carry one covering index).
  const INDEX_FACTOR = 2;
  const observedWrites =
    ((Number(row?.new_players) || 0) +
      (Number(row?.bests) || 0) +
      (Number(row?.daily) || 0) +
      (Number(row?.saves) || 0) +
      (Number(row?.rejects) || 0) +
      (Number(row?.payments) || 0)) * INDEX_FACTOR;

  const projectedWrites = projectDaily(observedWrites, hoursElapsed);

  // Reads are dominated by board fetches, which we cannot count from rows.
  // Approximate from active players; the number exists to spot an order-of-
  // magnitude change, not to be exact.
  const observedReads = (Number(row?.total_players) || 0) * 20;
  const projectedReads = projectDaily(observedReads, hoursElapsed);

  // ~300 bytes a row is measured from the schema's actual column widths.
  const estBytes =
    ((Number(row?.total_players) || 0) +
      (Number(row?.total_bests) || 0) +
      (Number(row?.total_daily) || 0)) * 300;

  const shed = shouldShed(projectedWrites) ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO ops (day, est_writes, est_reads, est_storage_bytes, shed, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(day) DO UPDATE SET
         est_writes = excluded.est_writes, est_reads = excluded.est_reads,
         est_storage_bytes = excluded.est_storage_bytes,
         shed = excluded.shed, updated_at = excluded.updated_at`,
    )
    .bind(day, projectedWrites, projectedReads, estBytes, shed, now)
    .run();

  return { day, projectedWrites, projectedReads, estBytes, shed, hoursElapsed };
}

/** The scheduled entry point. Prune first, then measure what is left. */
export async function runMaintenance(db, now = Math.floor(Date.now() / 1000)) {
  const removed = await prune(db, now);
  const measured = await measure(db, now);
  return { removed, ...measured, limits: LIMITS };
}
