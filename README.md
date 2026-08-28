# Dovefall — free-to-play backend

Accounts, cloud save and leaderboards for [Dovefall](https://gachichio.org),
on Cloudflare's free plan. The 1 GB VM is not involved.

| | |
|---|---|
| `f2p-infrastructure.md` | The costing and architecture analysis this came from |
| `DEPLOY.md` | Deploy from a clean checkout, with checkpoints |
| `site/` | The game bundle, served as Workers static assets — unmetered |
| `worker/` | The API: Cloudflare Worker + D1. `npm test` runs 116 tests |
| `godot/patches/` | Changes to the game, as applyable diffs |
| `godot/autoload/Net.gd` | The API client. Local-first; the network is never awaited |
| `godot/tools/` | Golden-vector emitter, for a future replay validator |

**Start with `DEPLOY.md`.**

The load-bearing test is `worker/test/rng.test.mjs`: the server's port of the
game's RNG must reproduce `4075699207`, the checksum Gate 9 requires the Pixel
and the desktop to agree on. If that fails, the server and the game no longer
share a physics and nothing else here can be trusted.

This directory is meant to be lifted into its own repository once the game has
one; it lives here because that is where the work started.
