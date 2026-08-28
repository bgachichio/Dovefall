-- Migration 0003 — paid respawns via Paystack.
--
-- The player pays on a hosted Paystack page (a static link), so the only way
-- to connect a payment to a player is a short code they enter at checkout.
-- pay_code is that code: minted once per player, shown in the game, typed into
-- the payment page's custom field. The webhook carries it back.

ALTER TABLE players ADD COLUMN respawns INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN pay_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS players_pay_code ON players(pay_code)
  WHERE pay_code IS NOT NULL;

-- One row per Paystack reference. The PRIMARY KEY is the idempotency guard:
-- Paystack retries webhooks, and a replayed reference must not credit twice.
-- Non-credited statuses are kept too — they are the audit trail for "I paid
-- and got nothing", which will happen, and which this table answers.
CREATE TABLE IF NOT EXISTS payments (
  reference   TEXT PRIMARY KEY,
  player_id   TEXT,
  amount      INTEGER,
  currency    TEXT,
  status      TEXT NOT NULL,   -- credited | no_player | below_min | wrong_currency
  raw_code    TEXT,            -- what the payer typed, for manual rescue
  at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS payments_recent ON payments(at DESC);
