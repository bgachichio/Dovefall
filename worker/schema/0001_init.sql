-- Dovefall — D1 schema, migration 0001.
--
-- Write budget is the design constraint. D1's free tier allows 100,000 row
-- writes a day, and every index that covers a written column costs an extra
-- write. So the rule this schema is built around is: WRITE ONLY ON IMPROVEMENT.
-- A run that does not beat the player's stored best costs zero writes; only a
-- personal best, a daily best, or a save sync touches the disk.

CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,          -- uuid v4, ours, never Google's
  google_sub    TEXT UNIQUE,               -- NULL while the player is a guest
  device_id     TEXT UNIQUE,               -- NULL once linked; guest recovery only
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  banned        INTEGER NOT NULL DEFAULT 0
);

-- One row per player per difficulty. Upserted only when the score improves.
CREATE TABLE IF NOT EXISTS bests (
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL,
  score         INTEGER NOT NULL,
  seed          TEXT,
  duration_ms   INTEGER,
  -- Replay log: the physics-tick index of every flap, delta-encoded. Stored
  -- from day one although nothing validates it yet, so that the day the
  -- validator lands the existing board can be checked rather than reset.
  flap_ticks    TEXT,
  -- Defensive record of the viewport the run was played at. Course generation
  -- currently depends on it (see godot/patches/07-playfield.md); recording it
  -- means a board built before that patch can be segmented rather than binned.
  playfield_h   INTEGER,
  build         TEXT,
  achieved_at   INTEGER NOT NULL,
  PRIMARY KEY (player_id, mode)
);

CREATE INDEX IF NOT EXISTS bests_board ON bests(mode, score DESC, achieved_at ASC);

-- The daily challenge: one shared seed, one row per player per day.
CREATE TABLE IF NOT EXISTS daily (
  day           TEXT NOT NULL,             -- YYYY-MM-DD, UTC
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score         INTEGER NOT NULL,
  duration_ms   INTEGER,
  flap_ticks    TEXT,
  playfield_h   INTEGER,
  achieved_at   INTEGER NOT NULL,
  PRIMARY KEY (day, player_id)
);

CREATE INDEX IF NOT EXISTS daily_board ON daily(day, score DESC, achieved_at ASC);

-- Cloud save. The client is local-first; this is the copy that survives a lost
-- phone or a cleared browser. `rev` is monotonic and the server refuses to go
-- backwards, so a stale device cannot overwrite a newer save.
CREATE TABLE IF NOT EXISTS saves (
  player_id     TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  rev           INTEGER NOT NULL,
  blob          TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Rejected submissions, written only when the claimed score WOULD have been a
-- personal best. A malformed client costs nothing; someone actually attacking
-- the board leaves a trail. This is how we find out what cheating looks like
-- here before building the expensive layer against it.
CREATE TABLE IF NOT EXISTS rejects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     TEXT,
  mode          TEXT,
  score         INTEGER,
  duration_ms   INTEGER,
  reason        TEXT NOT NULL,
  at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rejects_recent ON rejects(at DESC);
