-- Migration 0006 — the budget ledger.
--
-- One row per UTC day, written by the hourly cron. It is how the Worker knows
-- whether it is approaching a free-tier ceiling without spending the ceiling
-- to find out: counting rows is a read, and reads are the abundant budget.

CREATE TABLE IF NOT EXISTS ops (
  day               TEXT PRIMARY KEY,   -- YYYY-MM-DD, UTC
  est_writes        INTEGER NOT NULL DEFAULT 0,
  est_reads         INTEGER NOT NULL DEFAULT 0,
  est_storage_bytes INTEGER NOT NULL DEFAULT 0,
  -- 1 once the projection crosses 80% of the daily write limit. The request
  -- path reads this and drops non-essential writes until the day rolls over.
  shed              INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL
);
