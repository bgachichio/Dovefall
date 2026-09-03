# Dovefall

**One touch. Storm, deep and sky.**

A free-to-play arcade game. Canvas and about a thousand lines of
TypeScript on the client, Cloudflare Workers + D1 on the server, everything
inside the free plan. Accounts without email addresses, a leaderboard that can
be trusted, streaks that forgive one bad day, and paid respawns that can never
buy rank.

Play: **https://gachichio.org/dovefallgame** — phone, tablet or desktop, in
any browser. A tap, a click or the space bar; there is only ever one input.

**110 KB over the wire.** No engine, no download, no app store.

---

## Layout

| | |
|---|---|
| `DEPLOY.md` | **Start here.** Clean checkout to live, with a gameplay validation pass |
| `game/` | The game: engine, renderer, React shell. `npm test` runs the engine tests; `test/play.test.mjs` plays it in a real browser |
| `game/PARITY.md` | Does the web build still play like the Android build? Line by line, with the five things that had drifted |
| `worker/` | The API: Worker + D1, zero runtime dependencies. `npm test` runs 130 tests |
| `site/` | The Worker that serves the bundle. `npm run verify` preflights a deploy |
| `godot/` | The original Android project as patches, and the source of every tuned constant |
| `f2p-infrastructure.md` | The costing and architecture analysis this came from |

## Where the numbers come from

`game/tools/port-constants.mjs` transforms `Config.gd` and `Art.gd` out of the
Godot project into TypeScript. Gravity, the flap impulse, the gap table, the
chapter palettes and every pixel map were tuned over the life of the Android
build; retyping them by hand would introduce exactly the one-digit error nobody
finds until a player says it feels wrong. Regenerate with `npm run port`.

## The load-bearing tests

- `game/test/engine.test.mjs` asserts the RNG still reproduces **4075699207**,
  the checksum the Godot build's determinism gate requires. If it moves, the
  web game and the Android game are no longer the same game and the board means
  nothing.
- `game/test/play.test.mjs` opens the built bundle in six phone-sized Chromiums
  and proves they fly the **identical course** from the same seed at six
  different scales.
- `worker/test/rng.test.mjs` asserts the server's copy of the same stream. The
  client generates a course from a seed; the server re-derives it to check the
  score.

## Design rules worth knowing before changing anything

- **The core loop contains no words.** Every translatable string lives in a
  menu. Symbols in the loop, sentences outside it.
- **The world is 1080 × 1920, always.** The canvas is scaled to fit and
  letterboxed, so screen size changes the size of the picture and never the
  size of the playfield. This is what makes the leaderboard comparable.
- **Physics integrates on a fixed 1/120 s tick, never on frame delta.** A 60 Hz
  phone and a 120 Hz phone fly the same course.
- **Local-first.** The disk save is the source of truth; the network is never
  awaited by the game loop. Offline play is never worse than online.
- **Write only on improvement.** D1's free tier allows 100,000 row-writes a
  day, so a run that does not beat the player's best costs nothing.
- **Money never buys rank.** A continued run earns feathers and a local best,
  never a leaderboard place.
- **Portrait everywhere, and one input.** A tap, a click and the space bar are
  the same event. On a landscape screen the playfield is a centred column and
  the surround takes the chapter's sky. The only interception left is a *phone*
  held sideways, where every control would fall under the 44 px touch floor —
  a merely short desktop window is left alone.
- **The menus are DOM, not canvas.** A 48 px touch target is 48 CSS px on every
  phone, with no viewport scaling in between — the single biggest thing the web
  build gets for free.

## Deviations from `building.md`, stated out loud

| Rule | What we did | Why |
|---|---|---|
| §2.5 static hosting on Vercel | Cloudflare Workers static assets | The API and D1 are already on Cloudflare with 130 passing tests, and the artefact is still a portable `dist/` — the exit is still a weekend |
| §2.3 the data ladder starts at PGlite | D1 (SQLite at the edge) | Rung 0 is single-user; a leaderboard is not. The server half was already built and tested against this schema |
| §2.1 shadcn/ui | Tailwind v4 with hand-written primitives | Nine near-identical full-bleed game menus; the copy-in components would have been restyled to nothing |
