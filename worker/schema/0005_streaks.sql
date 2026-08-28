-- Migration 0005 — server-authoritative streaks.
--
-- The client already kept a local streak, but a local streak is three things
-- it should not be: lost when the phone is, invisible to the leaderboard, and
-- one save-file edit from meaningless. These columns make it the server's.
--
-- Write budget: a streak advances at most once per player per day, guarded by
-- `WHERE play_last_day IS NOT ?`, so this costs one row-write per active
-- player per day and nothing at all on a second run the same day.

ALTER TABLE players ADD COLUMN play_streak     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN play_best       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN play_last_day   TEXT;
ALTER TABLE players ADD COLUMN play_grace_week TEXT;

ALTER TABLE players ADD COLUMN daily_streak     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN daily_best       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN daily_last_day   TEXT;
ALTER TABLE players ADD COLUMN daily_grace_week TEXT;

-- Longest-streak leaderboard: a second thing to be best at, for players who
-- will never top a score board but never miss a day either.
CREATE INDEX IF NOT EXISTS players_daily_streak ON players(daily_best DESC)
  WHERE daily_best > 0;
