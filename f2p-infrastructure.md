# Dovefall — free-to-play infrastructure costing

What it costs to run Dovefall as a free-to-play game on web and Android, with
accounts and saved scores, from the existing 1 GB VM.

**Verdict:** marginal cost ≈ **$0/month** to roughly 50,000 monthly players — and
it stays that way only if the engine bundle is served from a CDN rather than from
the VM. Serving it from `africa-south1` costs about **$72/month at 100,000 web
players**, and that number grows every time the game does well.

Companion artifact: <https://claude.ai/code/artifact/7ed11a19-544e-46ec-a380-c00751ab4b34>

---

## 1 · The shape of the problem

Measured from the supplied project:

| | |
|---|---|
| GDScript | 2,589 lines across 15 files |
| Source | 172 KB |
| `store/` (Play listing PNGs) | 144 KB — 45% of the project, ships to nobody |
| Art assets | none — `Art.gd` generates sprites, `_draw()` paints the world |
| Audio assets | none — `Sfx.gd` / `Music.gd` synthesise `AudioStreamWAV` at runtime |

Three existing properties decide everything below:

1. **Compatibility renderer.** `rendering_method="gl_compatibility"` is GLES 3.0 on
   Android and WebGL 2.0 in a browser. The web build is a second export preset,
   not a port.
2. **Deterministic by design.** Seeded xorshift32 (`Rng.gd`), fixed 120 Hz step,
   `physics_jitter_fix=0.0`, boot checksum in `Main.gd`. `Rng.gd`'s own header:
   *"Submit the seed and the server can re-run it."*
3. **Nothing in the game loop touches the network.** Scores post at death,
   leaderboards load on demand, saves sync on pause. Every call tolerates 200 ms —
   which decouples hosting choice from latency entirely.

**Consequence:** the game is free to run. What costs money is delivering ~5 MB of
Godot engine to each new web player, once. That is the whole cost story.

---

## 2 · The decision that decides the bill

GCP charges ~$0.12/GB internet egress (Premium tier), and `africa-south1` is not
in the always-free tier — `building-SKILL.md` §2.4 already flags this and says
*verify the bill*. Cloudflare Pages serves static assets unmetered on the free
plan. The bundle is static.

| New web players / month | Bundle egress | From the VM | From Cloudflare |
|---|---|---|---|
| 1,000 | 6 GB | $0.72 | $0 |
| 10,000 | 60 GB | $7.20 | $0 |
| 50,000 | 300 GB | $36 | $0 |
| **100,000** | **600 GB** | **$72** | **$0** |
| 500,000 | 3 TB | ~$340 | $0 |

Assumes 6 MB per cold load (≈5 MB Brotli WASM + small PCK, with headroom).
Returning players load nothing. **Measure the real bundle after the first export** —
it is the one input worth confirming, and Africa egress can price above the
standard band.

**API traffic never becomes the problem.** A full session moves ~10 KB: token
refresh, save read, save write, score submit, two leaderboard pages. At 100,000
sessions/month that is 1 GB — twelve cents. *Assets scale; the API does not.*

Since Godot 4.3 the **single-threaded web export is the default** and needs no
COOP/COEP headers. Dovefall spawns no threads and loses nothing, so the bundle is
plain static files on any host — and embedding the game in a page alongside ads
stays possible, which cross-origin isolation would have prevented.

---

## 3 · RAM — the constraint that decides the stack

`building-SKILL.md` §3: 1 GB, ~750 MB usable, *count before you add*.

| Option | Resident | Gives you | Verdict |
|---|---|---|---|
| FastAPI + Postgres 16 | 230–270 MB | Canonical stack; auth is yours to write | Tight |
| **PocketBase** | **40–80 MB** | Auth + Google OAuth, DB, REST, realtime, admin UI | **Fits** |
| Headless Godot validator | 80–150 MB | Replays a run with the game's own physics; transient | Queue depth 1 |
| Supabase (hosted) | 0 MB | Free tier, but **pauses after 7 days idle** | Wrong shape |

PocketBase is not a preference — it is what the budget permits *if the replay
validator also lives on the box*. FastAPI + Postgres + validator peaks near
700 MB of 750. `building-SKILL.md` §4 already names PocketBase as the option that
"fits the VM where Supabase cannot."

**Exit (Selection Law test 5):** one SQLite file. `sqlite3 .dump` into Postgres is
an afternoon; keeping route shapes behind FastAPI is another. A weekend.

### Scale ladder

| Monthly players | What you run | What binds first | Marginal cost |
|---|---|---|---|
| 0 – 5,000 | Existing VM + Cloudflare | nothing | $0 |
| 5,000 – 50,000 | same | nothing | $0 |
| 50,000 – 150,000 | e2-small, or move the box | CPU burst credits | +$6–12/mo |
| 150,000 + | dedicated DB, validator on own worker | peak concurrency | +$20–40/mo |

e2-micro gives 0.25 vCPU sustained and bursts above. At one API call per
player-minute, 50,000 monthly players ≈ 1,000–2,000 concurrent at peak ≈ 30 req/s.
Comfortable. The rung above is where burst credits — not memory, not egress —
run out.

**On moving the VM:** a Hetzner CX22 is €4.49/mo for 2 vCPU, 4 GB RAM, 40 GB NVMe
and 20 TB traffic — four times the memory and effectively unmetered egress for
less than e2-micro costs in Johannesburg. `building-SKILL.md` §4 already says
"Hetzner or Contabo give more RAM for less — switch if af-south1 is billing."
Latency (Falkenstein→Nairobi ~170 ms vs ~40 ms) does not bind, because nothing in
the game loop waits on the network. **But don't move now** — relocating takes
Kenya Pulse and gachichio.org with it. Revisit when *RAM* forces it; that is a
clean trigger and a migration you'd be doing anyway.

---

## 4 · Accounts

Three sign-in paths, one player. They already share a root: a Play Games account
is a Google account.

- **Android** — Play Games Services sign-in. One tap, no password, free, and it
  provides cloud Saved Games at no cost. `TitleScreen.gd` already emits
  `leaderboard_pressed`; `Main.gd:113` currently just logs a warning.
- **Web** — Google OAuth through PocketBase.
- **The join** — your user row is the primary key; both of the above are identity
  providers resolving to the same Google subject. A player who starts on web and
  installs the app arrives with feathers and best scores intact.

**Guest-first.** Requiring an account before the first run is the most reliable
way to lose the player. Play against local storage; prompt only when they first
set a leaderboard-eligible score, or on day two.

**Store the OAuth `sub`, not the email address.** You do not need the address. Not
storing it shrinks the Play Data Safety declaration, shrinks DPA exposure, and
means a VM breach leaks nothing you'd have to disclose. Full player record ≈
300 bytes (subject id, display name, 4 best scores, feathers, skins, worn,
30-day daily window). 100,000 players ≈ 30 MB.

---

## 5 · A leaderboard worth believing

The web bundle is inspectable and anyone can POST to the API. Four layers:

| Layer | Stops | Cost |
|---|---|---|
| Auth token on submit | anonymous flooding | $0 |
| Rate limit + sanity bounds (score vs `duration_ms`) | crude fakes | $0 |
| **Replay validation on leaderboard candidates** | everything else | one headless run per candidate |
| Two boards: Daily (one shared seed) + All-time | makes outliers comparable | $0 |

**The replay is ~300 bytes.** Client submits
`{seed, mode, flap_ticks[], claimed_score, build}`. A sixty-gate run is ~90 s —
roughly 150 flaps across 10,800 ticks, delta-encoded.

**Validate only what would enter the board.** 99% of submissions never trouble the
top hundred. Even at 100,000 monthly players that is a few hundred validations a
day — which is why a transient 150 MB process is affordable on a 1 GB box.

**Run the validator as headless Godot, not a rewrite.** Reimplementing the physics
in Python means owning two implementations that must agree bit-for-bit forever;
the day they drift, the leaderboard quietly becomes fiction. Export a
dedicated-server build and run the *same GDScript* under `--headless`. The boot
checksum in `Main.gd` is already the test that proves validator and client agree.

**Protect the RNG separation.** `_new_part()` / `_step_parts()` use global
`randf()`; everything a player can die to comes through `Rng`. That split is
load-bearing — the day a particle collides, every ranked score becomes
unverifiable. Worth a comment in the file saying so.

---

## 6 · Six changes to make first

Ordered by consequence. 1–3 make a replay reconstructible; 4–5 only bite on web;
6 is a deliberate choice.

### 1. Move the flap onto the physics tick
`scripts/Game.gd:206–246` — `_unhandled_input()` calls `_flap()` directly.

Input is delivered at frame rate; physics runs at fixed 120 Hz. Setting `vy` from
the input handler means a tap lands at a moment that depends on the display —
quantised to ~16.7 ms at 60 Hz, ~8.3 ms at 120. A run therefore cannot be
reconstructed from wall-clock tap times.

Set `_flap_queued` in the input handler, consume it at the top of
`_physics_process`, append the tick counter to a `PackedInt32Array`. That gives
the replay log *and* removes the last frame-rate dependency from a game whose own
header promises there are none.

### 2. Decide what `assist` does before shipping a board
`scripts/Game.gd:124` (`_cur_gap()`), `:428` (`_die()`), `Config.DDA_WIDEN`.

`_cur_gap()` multiplies the gap by `(1.0 + assist)`, but `assist` is only ever set
to `0.0` — the "three deaths within two gates widens by four per cent" behaviour
in the comment is unimplemented and `DDA_WIDEN` is unused. Fine today; a
correctness hole the moment it is implemented, because two players would fly
different courses on the same seed. Either record `assist` in the replay, or make
`assist > 0.0` ineligible for ranking. Decide while it is a one-line filter.

### 3. Make Second Wind ineligible for the leaderboard
`scripts/Game.gd:255–276` — `_second_wind()` deletes gates and hazards ahead.

Replayable but fiddly, and a run continued by watching an advert shouldn't share a
table with one that wasn't. `second_wind_used` is already in the `run_end` event —
use it as the filter and delete a whole class of anti-cheat work.

### 4. Save encryption silently collapses on web
`autoload/SaveData.gd` — `_key()`.

`_key()` returns `"dovefall-" + OS.get_unique_id().substr(0, 16)`.
**`OS.get_unique_id()` is not implemented on web** (godotengine/godot#82439) — it
returns an empty string and logs an error. Every web player would share the key
`"dovefall-"`: publicly derivable and identical across installs.

Generate a UUID on first launch, persist it in `user://` (IndexedDB-backed in a
browser), derive the key from that. The file's own note already says the real
defence is server-side seed validation — this stops the local layer being theatre.

### 5. Stop shipping the Play Store screenshots
`export_presets.cfg` — `export_filter="all_resources"`, empty `exclude_filter`.

`store/` is 144 KB of listing artwork inside the export filter for both targets,
45% of the project by size, and no player will ever see it. Set
`exclude_filter="store/*"`.

### 6. Export web single-threaded, on purpose
Godot 4.3+ default; no COOP/COEP headers, so the bundle is ordinary static files
on any host. Dovefall spawns no threads and loses nothing. The alternative buys
cross-origin isolation you don't want — it would block embedding the game in a
page alongside ads.

---

## 7 · Revenue, briefly

**AdMob does not serve browsers.** The runbook's rewarded-video plan behind Second
Wind is Android-only. The web equivalent is **AdSense H5 Games Ads** — same two
formats (interstitial, rewarded) via the Ad Placement API. By-application, so
apply early rather than at launch.

Don't judge the web build on revenue. Its job is to be the thing you can put in a
link: a daily challenge that spreads because it is one shared seed and a URL, and
a leaderboard that gives the Android install a reason. Cost it as acquisition, and
the case for pushing its egress to $0 gets stronger.

**Analytics will out-weigh the game.** `Analytics._dispatch()` is a `print` stub
and the stack law retires Firebase. Volume first: 100,000 players × 50 runs × 4
events ≈ 20M events/month ≈ 3 GB — *more traffic than the game API*. Send
`run_end` always, sample the rest, batch uploads, roll into DuckDB on the Lenovo.
`building-SKILL.md` §2.4 already points at the cheapest version: Caddy logs →
DuckDB, no extra service on the VM.

---

## 8 · The part that isn't cost

Today the VM serves pages. Afterwards it is the sole custodian of every player's
identity and progress, with no redundancy. If the disk goes, the game survives and
every score does not — and unlike the game, scores cannot be rebuilt.

- **Backups are the product, not hygiene.** `developer.md` §8.5 already mandates
  3-2-1 and a restore drill every 90 days. Nightly SQLite `.backup`, gzipped: one
  copy on the VM, one to the Lenovo, one to Backblaze B2. Under 100 MB this is
  free forever. Log the drill date in the repo.
- **PocketBase binds `127.0.0.1`, Caddy reverse-proxies.** §8.4: nothing listens on
  `0.0.0.0` except Caddy, and an unauthenticated dashboard on a raw port is a
  finding. The admin UI goes behind Caddy with its own auth or an IP allow-list.
- **Write collection API rules before the collections ship.** Direct analogue of
  "RLS on every table". A player reads any leaderboard row, writes only their own.
- **Confirm the Kenya Pulse rotation actually happened.** `kenya-pulse/DEPLOY.md`
  opens with an S0 about four live credentials in skill files in a GitHub repo. The
  current skill files scan clean of credential patterns, so the text appears
  removed — but deleting a key from a file does not rotate it at the provider.
  Close that before the same VM holds player accounts.
- **Kenya DPA 2019 / ODPC.** Registration is generally required, with an exemption
  for controllers under KES 5M turnover *and* fewer than ten employees, overridden
  for certain mandatory sectors. A game is very unlikely to be in a mandatory
  category, so probably exempt — but that is a question for a Kenyan advocate, not
  one to assume.
- **Make the delete endpoint delete.** `SettingsScreen.gd:14` already links
  `gachichio.org/dovefall/delete`. Once real accounts exist it has to do the thing,
  for EU players especially.
- **Do not opt into Play Families.** The runbook flags this as due before wiring
  ads; accounts sharpen it. Targeting under-13s forbids the persistent identifiers
  both the ads and the leaderboard depend on. Declining costs reach and removes an
  entire compliance surface.

---

## 9 · The plan

| Phase | Work | Cost |
|---|---|---|
| 1 | The six changes above | 1 day · $0 |
| 2 | Web export → Cloudflare Pages (single-threaded; measure real bundle size) | ½ day · $0 |
| 3 | PocketBase on the VM: Google OAuth, cloud save, guest-first, behind Caddy | 1 day · $0 |
| 4 | Leaderboards, unverified — daily + all-time, sanity bounds only | ½ day · $0 |
| 5 | Replay validator — headless Godot, queue depth 1, top-100 only | 2 days · $0 |
| 6 | Analytics batching + nightly backups + first restore drill logged | ½ day · $0 |

Phase 4 before Phase 5 is deliberate: ship the board with cheap defences, find out
how it is actually attacked, then build the expensive layer against real behaviour.
If nobody cheats, you have saved two days.

---

## Sources

- Project measurements — read directly from the supplied Godot project.
- [Godot 4.3 web export size and single-threaded default](https://godotengine.org/article/progress-report-web-export-in-4-3/) · [web export docs](https://github.com/godotengine/godot-docs/blob/master/tutorials/export/exporting_for_web.rst)
- [`OS.get_unique_id()` empty on web — godotengine/godot#82439](https://github.com/godotengine/godot/issues/82439)
- [GCP Network Service Tiers pricing](https://cloud.google.com/network-tiers/pricing)
- [Cloudflare Pages free tier limits, 2026](https://temps.sh/blog/cloudflare-pages-free-tier-limits-2026)
- [Supabase pricing and free-tier pause, 2026](https://uibakery.io/blog/supabase-pricing)
- [Hetzner CX22 pricing, 2026](https://vpsfor.dev/posts/hetzner-cx22-pricing-2026/)
- [AdSense H5 Games Ads](https://adsense.google.com/start/solutions/h5-games-ads/)
- [Play Games Services overview](https://developer.android.com/games/pgs/overview)
- [ODPC registration: exemptions and mandatory requirements](https://datagovernance.africa/odpc-registration-in-kenya-understanding-exemptions-and-mandatory-requirements/) — not legal advice
- RAM figures and stack constraints — `building-SKILL.md` §3, `developer.md` §8
