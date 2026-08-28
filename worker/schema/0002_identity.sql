-- Migration 0002 — identity without email addresses.
--
-- A player is identified by a device-held id and a name they choose. The one
-- thing that arrangement lacks is a way back in after a lost or wiped phone,
-- which is normally what an email address is for. Instead: a recovery code the
-- player can write down.
--
-- We store only the SHA-256 of the code, so a copy of this database does not
-- let anyone take over an account.

ALTER TABLE players ADD COLUMN recovery_hash TEXT;
ALTER TABLE players ADD COLUMN recovery_issued_at INTEGER;

-- Bumped when an account moves to a new device. Session tokens carry the epoch
-- they were minted at, so claiming a recovery code signs the old device out —
-- which is the whole point of claiming it after a phone is stolen.
ALTER TABLE players ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS players_recovery ON players(recovery_hash)
  WHERE recovery_hash IS NOT NULL;
