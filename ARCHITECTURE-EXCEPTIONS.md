# Architecture exceptions

Two deviations from `games.md` and `building.md`, recorded per `games.md` §38
and `building.md`'s closing rule — *"Break a rule sooner than ship something
broken, but say so out loud... An undocumented exception is a bug."*

Neither deviation is undone by this file. Both are already shipped, tested and
live. This is the record that should have existed from the first commit.

---

## Exception 1 — the runtime is not Godot

```
Rule violated : games.md §8 (Godot node/scene/signal composition),
                games.md §41 invariant "GDScript as the default gameplay
                language", building.md §2.2.1 and §2.6.8 ("a game's runtime
                boundary is Godot rather than React + Vite").

Reason         : Dovefall began as a Godot 4.7 Android project. It had never
                 been built past a local editor session — no export, no
                 compile gate exercised — when the decision was made to ship
                 it. The web (HTML5/WASM) export path was evaluated first,
                 per games.md §28, and rejected: see "why it failed" below.

Alternative    : A canvas element drawn by hand-written TypeScript, with
                 React 19 owning only the menu chrome (DOM, not canvas — see
                 game/src/ui/kit.tsx). No game engine. Modelled on
                 flappylink.com's architecture, which the user supplied as a
                 reference.

Why it failed  : Measured, not assumed, against the Godot web export path:

                 - ~6 MB WASM/PCK payload vs. 110 KB actually downloaded by
                   the TypeScript build (game/PARITY.md).
                 - The export had never been validated end-to-end; every
                   deploy would have carried an unverified compile step as
                   its critical path.
                 - Godot's web export ships SharedArrayBuffer /
                   crossOriginIsolated feature probes in engine.js on every
                   export, threaded or not — an early verify-export.mjs
                   script mistook this for evidence of a threaded build and
                   would have blocked every real deploy while passing its
                   own synthetic fixture. Real, caught, fixed by deleting
                   the whole Godot web path rather than patching the false
                   positive.
                 - Godot's Compatibility renderer on mobile Safari/WebView
                   carries known viewport-scaling and input-latency
                   costs that a plain <canvas> with CSS-pixel DOM controls
                   does not: the touch-target floor in design.md §8.2
                   becomes literal (48 CSS px is 48 CSS px, no viewport
                   scale between them) rather than a runtime concern to
                   verify per device.

Blast radius   : None outside this repository. Dovefall is a standalone game,
                 not a dependency of any other build in the Unified
                 Open-Source Studio. No other project's Godot/Blender
                 pipeline is affected.

Exit path      : The simulation (game/src/engine/sim.ts) is a pure,
                 deterministic module with no DOM or React dependency —
                 seeded RNG, fixed 1/120 s tick, a checksum
                 (game/src/engine/rng.ts, worker/src/rng.js) that both the
                 client and the server's plausibility bounds are derived
                 from. It could be ported into GDScript by the same
                 mechanical transform that produced game/src/engine/
                 constants.ts from Config.gd (game/tools/port-constants.mjs),
                 run in reverse, if a native/Play Store build is ever a real
                 requirement. No current requirement exists.

Evidence       : game/PARITY.md (the Godot-vs-web gameplay audit — unchanged
                 simulation table, every drift named and fixed). 189 total
                 tests green (worker 145, game engine 37, game browser 7,
                 via Playwright against the actual built bundle). Live at
                 dovefall-site.bgkaranja.workers.dev, smoke-tested end to
                 end including the server's anti-cheat rejecting an
                 impossible score.

Approval       : Brian Gachichio Karanja, explicit and repeated in this
                 project's session history: "Now, please build out Dovefall
                 and get it launch-ready borrowing on Flappy Link" (the
                 instruction that started the rewrite); "please confirm
                 that the gameplay is not affected (negatively) in any way
                 by the major architectural changes... Confirm this and
                 then push everything to GitHub, ready to build" (the
                 instruction confirming it).
```

---

## Exception 2 — no committed handover packet before implementation

```
Rule violated : building.md §0.1, the AI Handoff Law — "Claude Chat
                architects, Claude Code builds, and nothing moves from the
                first to the second until there is nothing left to decide"
                — and §7.1, which names CLAUDE.md, BUILD-BRIEF.md (and
                GAME-BRIEF.md for a game shape) as artefacts committed
                BEFORE the first CLI session.

Reason         : This project's architecture — the Godot-to-canvas rewrite,
                 the Cloudflare Workers + D1 backend, the glide retune's
                 gravity/flap/speed arithmetic, kids mode's design — was
                 decided inside Claude Code terminal sessions, directly
                 against the user's live direction, with no prior Claude
                 Chat architecture pass producing a committed packet.

Alternative    : None applied retroactively. Fabricating a CLAUDE.md or
                 BUILD-BRIEF.md now, dated as if it preceded work that has
                 already shipped, would misrepresent the record rather than
                 correct it.

Why it failed  : The engagement pattern was conversational and iterative —
                 screenshots, live terminal output, mid-session redirects —
                 which is real, common shape for solo/indie work and not
                 itself a defect. The gap is procedural: no packet exists to
                 audit the architecture against, so an agent picking this
                 repo up cold has to reconstruct intent from commit
                 messages and PARITY.md rather than read it from one place.

Blast radius   : Confined to this repository's own process hygiene. No
                 dependency, secret, port or shared-VM tenancy was placed
                 outside review — see Exception 1's evidence and the
                 deployment gates below.

Exit path      : This file, README.md, game/PARITY.md and DEPLOY.md
                 together now carry what a BUILD-BRIEF.md would have held:
                 the five-line spec is recoverable from README.md's
                 opening section, the preflight arithmetic from PARITY.md,
                 the deployment shape from DEPLOY.md. A future non-trivial
                 change to this project should route through a proper
                 Claude Chat architecture pass and land a real CLAUDE.md /
                 BUILD-BRIEF.md rather than extend this exception.

Evidence       : This document exists because the gap was checked for and
                 found, not asserted. `find . -iname "CLAUDE.md" -o -iname
                 "BUILD-BRIEF.md" -o -iname "GAME-BRIEF.md"` returns nothing
                 in this repository.

Approval       : Recorded retroactively, 2026-09-10, on the user's explicit
                 request to confirm alignment with games.md and building.md.
                 Not yet reviewed by Brian; this record is the review
                 artefact itself.
```

---

## What is NOT an exception

Checked against `building.md` and found to already comply, so not listed
above:

- **§2.5 platform.** `building.md` §2.5 names Cloudflare free tier as an
  explicit alternative to the GCP VM for a server component ("Server: GCP
  e2-micro... **or Cloudflare free**"). Dovefall's Worker + D1 backend is
  that named alternative, not a departure from it — and it sidesteps the
  shared VM's §3.1 coexistence check and §10.2 port registry entirely,
  because nothing here is a tenant of `deltabot-vm-za`.
- **§6 non-negotiable defaults.** Font-size toggle, Auto/Light/Dark theme,
  a settings panel backed by `localStorage`, and an installable offline
  PWA are all implemented (`game/src/chrome.ts`, `game/src/store.ts`,
  `game/src/ui/Screens.tsx`, `vite-plugin-pwa` in `game/vite.config.ts`).
- **§9 banned dependencies.** No MUI, Emotion, Ant Design, Chakra,
  Bootstrap, styled-components, Chart.js, Font Awesome or Google Fonts CDN
  tag anywhere in `game/package.json` or `site/package.json`.
- **§8 DEPLOY.md.** Exists, carries all ten required sections, and has been
  run from a clean checkout rather than only drafted.
- **Local-first.** The client's own save is authoritative and the network
  a convenience — `game/src/store.ts`'s own header states this as a design
  rule, and `game/src/net/api.ts` fails soft on every call.
