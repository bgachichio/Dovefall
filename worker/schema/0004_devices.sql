-- Migration 0004 — up to two devices per account.
--
-- Until now a player WAS a device: players.device_id was unique and singular,
-- so the phone and the laptop were two unrelated strangers. This moves the
-- binding into its own table so one account can hold a phone and a laptop,
-- which is the shape people actually play in.
--
-- Two is a cap, not a suggestion. Signing a third device in evicts the one
-- used longest ago and bumps the session epoch, so the evicted device is
-- genuinely signed out rather than merely forgotten.

CREATE TABLE IF NOT EXISTS devices (
  device_id   TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

-- The eviction query orders by last_seen within a player.
CREATE INDEX IF NOT EXISTS devices_player ON devices(player_id, last_seen ASC);

-- Carry every existing binding across. players.device_id stays on the table as
-- dead weight rather than being dropped: SQLite rewrites the whole table for a
-- DROP COLUMN, and a nullable unused column costs nothing. The code stops
-- reading it at this migration.
INSERT OR IGNORE INTO devices (device_id, player_id, first_seen, last_seen)
SELECT device_id, id, created_at, last_seen_at
  FROM players
 WHERE device_id IS NOT NULL;
