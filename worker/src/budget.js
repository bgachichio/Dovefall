// Staying under 80% of every free-tier limit, without spending the budget to
// measure it.
//
// THE MEASUREMENT PROBLEM. A Worker cannot query its own D1 usage, and a
// counter incremented on every write would double the write cost — the meter
// would consume what it measures. So the hourly cron COUNTS ROWS BY TIMESTAMP
// instead (reads are the abundant budget: 5,000,000/day against 100,000
// writes), extrapolates the day, and records one row. That is 24 writes a day
// to watch 100,000.
//
// WHAT HAPPENS AT 80%. The Worker sheds non-essential writes and keeps the
// ones a player would notice. A leaderboard that stops recording personal
// bests is broken; one that stops logging rejects and throttles cloud saves
// harder is merely quieter. Shedding is graceful degradation, never an outage.

/** Cloudflare free-plan ceilings, and the fraction we refuse to cross. */
export const LIMITS = {
  d1_rows_written: 100_000,   // per day
  d1_rows_read: 5_000_000,    // per day
  d1_storage_bytes: 5 * 1024 * 1024 * 1024,
  worker_requests: 100_000,   // per day
};

export const SHED_AT = 0.8;

/** How long each table's rows are worth keeping. */
export const RETENTION_DAYS = {
  daily: 35,       // a month of daily boards, plus a margin for month-end views
  rejects: 30,     // long enough to see a pattern, short enough to stay small
  payments: 400,   // over a year: this is the audit trail for real money
  ops: 90,
};

/**
 * Extrapolate a day's total from what has happened so far.
 *
 * Deliberately linear rather than clever: play is bursty and evening-heavy, so
 * a smarter model would be confidently wrong. Early in the UTC day the sample
 * is small, so the estimate is held at the observed count rather than
 * multiplied up — otherwise three writes at 00:05 would project 864 and every
 * quiet morning would look like a crisis.
 */
export function projectDaily(observed, hoursElapsed) {
  if (!Number.isFinite(observed) || observed < 0) return 0;
  const h = Math.max(0, Math.min(24, Number(hoursElapsed) || 0));
  if (h < 2) return observed;
  return Math.round(observed * (24 / h));
}

/** Fraction of a limit a projection represents, clamped for display sanity. */
export function utilisation(projected, limit) {
  if (!limit) return 0;
  return Math.min(9.99, Math.max(0, projected / limit));
}

/**
 * Should the Worker shed non-essential writes?
 *
 * Takes the recorded projection, so the decision is one cheap read rather than
 * a recount on every request.
 */
export function shouldShed(projectedWrites) {
  return utilisation(projectedWrites, LIMITS.d1_rows_written) >= SHED_AT;
}

/**
 * A human-readable snapshot. Used by /v1/health so the state of the budget is
 * one curl away rather than a dashboard hunt.
 */
export function report(row) {
  const writes = Number(row?.est_writes) || 0;
  const reads = Number(row?.est_reads) || 0;
  const bytes = Number(row?.est_storage_bytes) || 0;
  const pct = (v, l) => Math.round(utilisation(v, l) * 1000) / 10;
  return {
    day: row?.day ?? null,
    shedding: Number(row?.shed) === 1,
    threshold_pct: SHED_AT * 100,
    d1_rows_written: { projected: writes, limit: LIMITS.d1_rows_written, pct: pct(writes, LIMITS.d1_rows_written) },
    d1_rows_read: { projected: reads, limit: LIMITS.d1_rows_read, pct: pct(reads, LIMITS.d1_rows_read) },
    d1_storage: { bytes, limit: LIMITS.d1_storage_bytes, pct: pct(bytes, LIMITS.d1_storage_bytes) },
  };
}
