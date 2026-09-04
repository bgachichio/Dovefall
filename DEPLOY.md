# DEPLOY.md — Dovefall

## 1 · What this is

Dovefall is a one-touch arcade game that runs in a browser — phone, tablet or
desktop. Three deployables, all on Cloudflare's free plan; the only thing
outside it is the domain, `gachichio.org`, which you already own.

| | What | Where | If it stops |
|---|---|---|---|
| `game/` | The game itself — canvas + React, **110 KB over the wire**, any browser | built to `game/dist/` | nothing to play |
| `site/` | A Worker that serves that bundle as static assets | `gachichio.org/dovefallgame/` | nothing to play |
| `worker/` | The API — accounts, scores, saves, payments | `dovefall-api.<sub>.workers.dev` | the game still plays; no board, no new scores |
| D1 `dovefall` | The database | already created | the API returns errors; local saves are untouched |

**There is no game engine and no download.** The Godot project is still the
source of the tuned constants — `game/tools/port-constants.mjs` transforms them
into TypeScript — and it remains the Android build path, but the web game is
its own thing and nothing on the web waits for Godot.

**The riskiest step is §6c**, the DNS move. Everything before it is additive and
reversible in under a minute.

---

## 2 · Prerequisites

**Node 22 or newer. This is a hard floor, not a preference.**

| | Why it will not work below 22 |
|---|---|
| `worker` tests | They run the real Worker against a real SQLite copy of the real schema. That is `node:sqlite`, which does not exist before Node 22 — on Node 20 seven test files die with `ERR_UNKNOWN_BUILTIN_MODULE` |
| `wrangler` 4.128 | Refuses to start: *"Wrangler requires at least Node.js v22.0.0"*. No login, no deploy |
| `node --test` globs | Node 20 does not expand a test pattern itself |

Every package declares `engines: node >=22.20.0` with `engine-strict=true`, so
`npm install` **fails immediately** on an older Node rather than warning and
installing anyway. If you see `EBADENGINE`, that is this working — upgrade and
run it again.

```bash
# If you do not have nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
exec $SHELL

nvm install 22
nvm use 22
nvm alias default 22

node --version        # must print v22.20.0 or newer
```

| | Version | Notes |
|---|---|---|
| Node | **22.20+** | `nvm install 22` |
| npm | ships with Node | — |
| Wrangler | 4.128, per-project | already in `devDependencies` |
| Playwright | 1.56.1, per-project | already in `devDependencies`; the browsers are a separate download, see §4 |
| A Cloudflare account | free plan | already yours |

**Never build on the VM.** `npm run build` on a 1 GB box gets killed without a
clear message. Build on the Lenovo and ship `dist/`.

---

## 3 · Secrets

Three, all set with `wrangler secret put` and **never written to a file**.
`wrangler.toml` holds configuration only; if a value would be dangerous in a
public repository, it does not belong there.

```bash
cd worker

# 32 random bytes, generated and consumed in one command so the value is never
# printed, never in your scrollback, never in shell history. Rotating it signs
# every player out — which is also your panic button if a token ever leaks.
#
# Do NOT run `openssl rand` on its own and copy the output. A secret that has
# been displayed has been exposed, and the only safe response is to generate
# another one.
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET

# Your Paystack SECRET key (sk_test_… first, sk_live_… when you go live). It
# signs every webhook; without it the payments endpoint trusts nothing.
npx wrangler secret put PAYSTACK_SECRET

# Optional. Comma-separated Google OAuth client IDs, for when you wire sign-in.
# Guest play — which is every player on day one — works without it.
npx wrangler secret put GOOGLE_CLIENT_IDS
```

```bash
npx wrangler secret list     # expect the names, never the values
```

| Name | Obtained from | Rotate if |
|---|---|---|
| `SESSION_SECRET` | `openssl rand -base64 32` | any session token is seen by anyone |
| `PAYSTACK_SECRET` | Paystack dashboard → Settings → API Keys | it appears anywhere outside Paystack |
| `GOOGLE_CLIENT_IDS` | Google Cloud console | not a secret; here for convenience |

---

## 4 · First run — clean checkout to playing locally

```bash
git clone https://github.com/bgachichio/Dovefall.git
cd Dovefall

# 1 · the API, against a real SQLite copy of the real schema
cd worker && npm install && npm test
#   expect: # pass 130   # fail 0

# 2 · the game — engine tests, then the browser suite
cd ../game && npm install

# The browsers are a ~180 MB download, separate from the library, and only
# needed once. Run it from game/ so it uses the project's own playwright and
# the versions match — `npx playwright install` from anywhere else fetches
# browsers for whatever version npx happens to resolve.
npx playwright install chromium

npm run build
npm test
#   expect: # pass 29    # fail 0    # skipped 0
#
#   22 engine tests plus 7 in a real Chromium. If it says 7 were SKIPPED, the
#   browsers are missing — the skip reason names the command to fix it.

# 4 · play it yourself
npm run dev
#   then open the printed URL — on your phone over the same wifi, or straight
#   on the laptop. Both play.
```

**You should see**, in the browser console on the phone, one line per resize:

```
dovefall: viewport 448x936 css, dpr 2.857, framebuffer 1280x2674, scale 0.415
```

The scale differs per device. Nothing else does — see §7a.

---

## 5 · Build

```bash
cd game
VITE_API_BASE=https://dovefall-api.<your-subdomain>.workers.dev \
VITE_SHARE_URL=https://gachichio.org/dovefallgame \
npm run build
```

| | Expected |
|---|---|
| Duration | under 3 seconds |
| `dist/` uncompressed | ~0.31 MB |
| Over the wire | **~0.11 MB** |
| Artefact | `game/dist/` — a plain folder of static files |

> Leaving `VITE_API_BASE` unset is a valid ship state: the game plays entirely
> offline, with local bests and no leaderboard. It is the fastest rollback
> there is and it needs no server at all.

---

## 6 · Deploy

### 6a · The API

```bash
cd worker
npx wrangler d1 migrations apply dovefall --remote
npx wrangler deploy
```

**You should see** a `https://dovefall-api.<sub>.workers.dev` URL. Check it:

```bash
API=https://dovefall-api.<sub>.workers.dev
curl -s $API/v1/health | head -c 400
```

Expect `"ok": true`, eight tables, and a `budget` block reading well under 80%.

### 6b · The game

```bash
cd ../site
npm install
npm run sync                                     # copies game/dist in
node verify-build.mjs public/dovefallgame --origin https://gachichio.org/dovefallgame/
npx wrangler deploy
```

The preflight **blocks the deploy** on: the bundle being loaded by a plain
`<script src>` (which would bypass the mobile-only gate and download the game
to every laptop), a missing entry, an absolute asset path that would 404 under
`/dovefallgame/`, a manifest naming an icon that is not there, or link previews
pointing at a host you are not deploying to.

**At this point the game is live and shareable on a `workers.dev` URL.** Open
it on your phone. Everything below is the address bar.

### 6c · The address — `gachichio.org/dovefallgame/`

This is the only step that touches DNS for a domain already serving traffic.
Do it when you have a calm hour.

1. Add `gachichio.org` to Cloudflare (Websites → Add a site → Free).
2. Copy the two nameservers Cloudflare gives you into Porkbun.
3. Wait for the zone to go **Active** (minutes to a few hours).
4. In Cloudflare DNS, confirm the root `A` record still points at the VM, and
   set it to **Proxied** (orange cloud). This is what lets a Worker route fire
   on a path.
5. Uncomment option **A** in `site/wrangler.toml` and redeploy:

```bash
npx wrangler deploy
curl -sI https://gachichio.org/dovefallgame/ | head -3
```

6. Add the new origin to the API's allow-list and redeploy it:

```bash
# worker/wrangler.toml → ALLOWED_ORIGINS
cd ../worker && npx wrangler deploy
```

> **Blast radius.** Option A puts every request to `gachichio.org` through
> Cloudflare on its way to Caddy. Option B (`dovefall.gachichio.org`) is a
> CNAME only, leaves the root grey-cloud, and cannot affect the VM at all. It
> is strictly safer and a different URL. Both are written out in
> `site/wrangler.toml`.

---

## 7 · Verify — the gameplay pass

Every line below is a thing that has broken in this codebase or could. Star
means do it on a real phone.

### 7a · Rendering — the fairness guarantee

The world is **1080 × 1920 on every device**, scaled to fit and letterboxed. A
bigger phone buys a bigger picture, never a bigger playfield. Measured in
Chromium by `game/test/play.test.mjs`:

```
  device                          css        framebuffer   scale
  Pixel 9 Pro                448x936        1280x2674     0.415
  iPhone 16                  393x852        1179x2556     0.364
  iPhone 16 · Safari bars    393x745        1179x2235     0.364
  Galaxy S24                 360x700        1080x2100     0.333
  iPhone SE                  375x553         750x1106     0.288
  iPad mini                 744x1000        1488x2000     0.521

  gates from the daily seed, on all six: [277, 271, 338]
```

Six devices, six scales, one course. That identity is asserted, not assumed —
if geometry ever leaks into the simulation, that test goes red.

| # | Do | Expect |
|---|---|---|
| 1 | ★ Open it on the Pixel 9 Pro | Full-width sky, thin bars top and bottom, no horizontal scroll |
| 2 | ★ On an iPhone 16 in Safari, scroll once so the toolbar collapses | The game **grows into the space**; it never sits behind the bar |
| 3 | ★ Share ▸ Add to Home Screen, then open it | Full screen, no browser chrome, and it will not rotate |
| 4 | ★ Turn the phone sideways mid-run | "Turn your phone upright", **and the run pauses** |
| 5 | Open the same URL on a laptop | It **plays**: a centred portrait column, sky either side, "CLICK TO FLAP". Mouse and space bar both flap |
| 5b | Make the laptop window short and wide (900 × 420) | Still plays, still pillarboxed. **No** "turn your phone" prompt — that is for phones |
| 6 | ★ Tap every menu control on the smallest phone you have | Nothing needs a second attempt |
| 7 | Pass score 5, 15, 30 | The sky, the gates and the letterbox bars **change together** at each chapter |

### 7a-ii · Feel — the five that drifted once

These are the parity fixes from `game/PARITY.md`. Each one was wrong at some
point in the port and is cheap to re-break.

| # | Do | Expect |
|---|---|---|
| 1 | ★ Tap to flap, with the sound on | The blip is **simultaneous with the thumb**, not a frame late |
| 2 | Pass gates 5, 10, 15 | The gate tone **climbs a semitone every five** |
| 3 | Beat your own best mid-run | A three-note chime at the moment you pass it, not on the death panel |
| 4 | ★ Lock the phone for a minute mid-run, unlock | The world resumes; it does **not** lurch forward |
| 5 | Take a respawn and watch the countdown | Nothing moves. Not even a drifting gate |
| 6 | Die while tapping fast | The panel ignores you for a third of a second — you do not skip your own score |
| 7 | Die twice in a sitting with a score over 8 | The second wind is offered on the second death, not never |

### 7b · The first run

| # | Do | Expect |
|---|---|---|
| 1 | Open in a private window | **Choose your name**, with three suggestions from the server |
| 2 | Tap a suggestion | It saves and a run begins immediately — no menu in between |
| 3 | Fly and die once | The death panel, with a **pulsing gold ♥** holding one free respawn |
| 4 | Tap the ♥ | The sky ahead clears, a countdown runs, the flight continues |
| 5 | Die again, tap Back | The title screen. The tutorial never appears again |

### 7c · Interruption

| # | Do | Expect |
|---|---|---|
| 1 | ★ Mid-run, switch apps and come back | Paused, not dead. One tap resumes |
| 2 | ★ Mid-run, lock the screen for a minute | The same. No burst of physics on return |
| 3 | Kill the tab mid-run and reopen | Title screen, best and feathers intact |

### 7d · Accounts, scores and streaks

| # | Do | Expect |
|---|---|---|
| 1 | Set a personal best | `curl -s $API/v1/board/normal` shows it within a second |
| 2 | Settings ▸ Account ▸ Get a recovery code | A 14-character code, shown once |
| 3 | Private window ▸ Restore my account with that code | Your name and tag come back |
| 4 | Play on a third device | The oldest of the two is signed out |
| 5 | Play on two consecutive days | The streak reads 2 on the title screen |

### 7e · Payments — test mode first

| # | Do | Expect |
|---|---|---|
| 1 | Respawns ▸ Copy code | A short code in Crockford base32 |
| 2 | Pay with Paystack, over KES 50, with the code in the note | Paystack confirms |
| 3 | Tap "I have paid" | ♥ goes up by 3 |
| 4 | Die, tap ♥ | The run continues, and the death panel marks it **unranked** |
| 5 | Finish that run with a high score | It is **not** on the leaderboard. Money never buys rank |

### 7f · Offline

| # | Do | Expect |
|---|---|---|
| 1 | ★ Aeroplane mode, open from the home screen | It plays. Bests are kept locally |
| 2 | Turn the network back on and play | The new best appears on the board |

---

## 8 · Rollback

| What broke | Command | Time |
|---|---|---|
| The game | `cd site && npx wrangler rollback` | under 60 s |
| The API | `cd worker && npx wrangler rollback` | under 60 s |
| Everything | Rebuild `game/` with `VITE_API_BASE` unset, `npm run sync && npx wrangler deploy` — the game plays offline with no server at all | ~2 min |
| A leaked session secret | `npx wrangler secret put SESSION_SECRET` with a new value. Every player is signed out and every token is void | 30 s |
| DNS | Set the root `A` record back to grey-cloud in Cloudflare, or move the nameservers back to Porkbun | minutes |

_Last tested: run it before you need it._

---

## 9 · Troubleshooting

**A phone in landscape says "Turn your phone upright" and will not play.**
Deliberate. Below 480 px of height every control falls under the 44 px touch
floor, and shrinking them to fit would be worse than asking. The threshold is
one line in `game/index.html`, and it only applies to touch-first devices — a
short desktop window is never intercepted.

**A CORS error in the console.**
The error names the origin it wanted. Put that exact string into
`ALLOWED_ORIGINS` in `worker/wrangler.toml` and redeploy the API.

**Scores are refused with `too_fast` or `bad_score`.**
The server checks that a score is arithmetically possible for its duration.
`curl -s $API/v1/health` shows the bounds. If a legitimate run is being
refused, the tolerance in `worker/src/bounds.js` is the dial — and the fact
that it fired is the system working.

**The leaderboard is empty but scores are being accepted.**
Only ranked runs appear. A run that used a respawn is deliberately excluded,
and so is a tutorial run.

**`git pull` aborts: "local changes to game/package-lock.json would be overwritten".**
`npm install` rewrites lock files — especially across npm major versions — so a
pull after an install finds the file dirty and refuses. The lock file is
generated, so discarding it is safe:

```bash
git restore game/package-lock.json   # or worker/, or site/
git pull
```

If it happens on more than one, `git restore '*/package-lock.json'`. Pull
first, install second, and it does not arise.

**`npm run build` is killed.**
You are on the VM. Build on the Lenovo and ship `dist/`.

**A payment did not credit.**
Check the Paystack dashboard for a delivered webhook. The endpoint verifies an
HMAC-SHA512 signature, so a wrong `PAYSTACK_SECRET` shows as a delivered
webhook with a 401. Fix the secret and use Paystack's "resend" button.

---

## What this deployment does not do

- **It does not replay runs.** It checks that a score is arithmetically
  possible for its duration, which catches crude attacks and nothing subtle.
  The replay log is captured and stored from day one, so historical runs become
  checkable the day a validator lands.
- **It has no landscape layout.** The world is portrait, so on a wide screen it
  is a centred column with sky either side. That is the design, not a fallback —
  but it does mean a laptop shows a lot of sky.
- **It does not wire Google sign-in.** The endpoints and the token verification
  are built and tested; the button is not. Guest play covers the whole loop.
- **The Swahili strings were written by an agent, not a speaker.** Have someone
  read them before the Kiswahili option ships.
