# Dovefall

**One touch. Storm, deep and sky.**

A free-to-play arcade game — Godot on the client, Cloudflare Workers + D1 on
the server, everything inside the free plan. Accounts without email addresses,
a leaderboard that can be trusted, streaks that forgive one bad day, and paid
respawns that can never buy rank.

Play: **https://gachichio.org/dovefallgame**

---

## Layout

| | |
|---|---|
| `DEPLOY.md` | **Start here.** Deploy from a clean checkout, with a gameplay validation pass |
| `worker/` | The API: Worker + D1, zero runtime dependencies. `npm test` runs 130 tests |
| `site/` | The game bundle, served as Workers static assets — unmetered |
| `godot/patches/` | Changes to the game project, as applyable diffs |
| `godot/autoload/`, `godot/ui/` | New files to copy into the Godot project |
| `godot/tools/` | Golden-vector emitter, for a future replay validator |
| `f2p-infrastructure.md` | The costing and architecture analysis this came from |

## The load-bearing test

`worker/test/rng.test.mjs` asserts that the server's port of the game's RNG
reproduces **4075699207** — the checksum Gate 9 requires the Pixel and the
desktop to agree on. If it fails, the server and the game no longer share a
physics and nothing else here can be trusted. It is the first test for a reason.

## Design rules worth knowing before changing anything

- **The core loop contains no words.** Every translatable string lives in a
  menu. Symbols in the loop, sentences outside it.
- **Local-first.** The disk save is the source of truth; the network is never
  awaited by the game loop. Offline play is never worse than it was before
  there was a server.
- **Write only on improvement.** D1's free tier allows 100,000 row-writes a
  day, so a run that does not beat the player's best costs nothing.
- **Money never buys rank.** Ad-continued and paid-continued runs earn feathers
  and a local best, never a leaderboard place.
- **`stretch/aspect="keep"`.** The viewport is exactly 1080×1920 on every
  screen. This is not cosmetic — under `expand` the game was unplayable in
  landscape. See `godot/patches/07-playfield-fairness.md`.
