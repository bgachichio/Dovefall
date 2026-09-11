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

**The riskiest step is §6c**, the DNS move — and the risk is your Zoho email
and an enabled DNSSEC, not the website. Everything before it is additive and
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

# Your Paystack SECRET key (sk_test_… first, sk_live_… when you go live).
#
# The NAME matters: the Worker reads env.PAYSTACK_SECRET_KEY. Set it under any
# other name and /v1/paystack/webhook answers 503 "Payments are not configured"
# for ever — Paystack keeps retrying, the dashboard shows failures, and not one
# payment ever credits a heart.
#
# This is the only Paystack credential the game needs. The PUBLIC key is for
# Paystack's inline checkout, which this game does not use: it opens a hosted
# payment page instead, so there is nothing for a public key to do. See §6d.
npx wrangler secret put PAYSTACK_SECRET_KEY

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
| `PAYSTACK_SECRET_KEY` | Paystack dashboard → Settings → API Keys & Webhooks | it appears anywhere outside Paystack |
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
npm run build
```

That is the whole command. `game/.env.production` carries `VITE_API_BASE` as
a committed default now, not something to remember to type — a bare
`npm run build` used to ship a silently offline game (no account, no
leaderboard, no payments, and nothing on screen said why), because Vite's
own default for an unset variable is empty, not "point at production." That
is not hypothetical: it is exactly what shipped for a few hours before this
file existed. `VITE_SHARE_URL` needs no setting at all — the share link
reads `location.origin` at runtime, so it always matches wherever the
bundle actually ends up served.

| | Expected |
|---|---|
| Duration | under 3 seconds |
| `dist/` uncompressed | ~0.31 MB |
| Over the wire | **~0.11 MB** |
| Artefact | `game/dist/` — a plain folder of static files |

**The rollback still exists, on purpose, one level up.** An explicit empty
value on the command line overrides the committed default — Vite's own
precedence, a shell-set variable always wins over `.env.production`:

```bash
VITE_API_BASE= npm run build     # deliberately offline, verified to still work
```

That is §8's "Everything" row: the game plays with local bests and no
leaderboard, and needs no server at all. The difference this section makes
is that reaching that state now takes typing something, not forgetting to.

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

# Prove the schema is really there. Do NOT use `wrangler d1 list` for this —
# its num_tables column reports 0 against a database with the full schema and
# a working API in front of it, so it cannot tell success from failure.
npx wrangler d1 execute dovefall --remote \
  --command "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table';"
```

Expect `"ok": true` and a `budget` block well under 80%, then a table count of
**at least 9** — the eight the game uses plus `d1_migrations`.

> The API's root path answers `{"error":"not_found"}`. That is correct: there
> is no route at `/`, only under `/v1/`. Use `/v1/health` to check it is up.

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

### 6c · The address — moving gachichio.org onto Cloudflare

This is the only step that touches a domain already carrying live traffic,
and — measured on 2026-09-09 — that traffic is not only a website.

**What gachichio.org actually is today**

```
NS      fortaleza / maceio / salvador / curitiba .ns.porkbun.com
A       gachichio.org       34.35.177.164      (Google Cloud — the VM)
A       www.gachichio.org   34.35.177.164
MX      mx.zoho.com (10), mx2.zoho.com (20), mx3.zoho.com (50)
TXT     v=spf1 include:zohomail.com ~all
TXT     zoho-verification=zb86633368.zmverify.zoho.com
TXT     google-site-verification=CdYarAMYSqT4MyfdwqDewew9iHKTQ-uWdIUPwChWlJE
CAA     none
DS      present at .org  →  DNSSEC IS ENABLED
SOA     hostmaster is dns.cloudflare.com
```

Two of those lines are the whole risk, and neither is the website.

**Your email is on this domain.** Three Zoho MX records and an SPF record.
Lose them in the move and mail stops — silently, from the sender's point of
view, for as long as it takes anyone to notice.

**DNSSEC is on.** Porkbun has published a DS record at `.org` that says "my
answers for this zone are signed, and here is the key". Point the nameservers
at Cloudflare while that DS still stands and every validating resolver on the
internet — which is most of them — will refuse Cloudflare's unsigned answers
outright. Not a degraded site: `SERVFAIL`, for the website AND the mail, until
the DS clears. **Turn DNSSEC off at Porkbun first and let it clear before you
touch the nameservers.**

The SOA's hostmaster field says `dns.cloudflare.com`, which means this zone
lived on Cloudflare at some point. Check whether `gachichio.org` is still
sitting in the account as an inactive zone before adding it: if it is, flipping
the nameservers publishes *that* zone's records — whatever they were the day it
was abandoned — not the ones you are about to check.

**The order**

1. Porkbun → gachichio.org → **disable DNSSEC**. Wait for
   `dig +short DS gachichio.org @1.1.1.1` to come back empty. Usually under an
   hour; the TTL at `.org` decides.
2. Cloudflare → Websites → Add a site → Free. If a `gachichio.org` zone already
   exists in the account, open that one instead and audit every record in it.
3. **Before switching anything**, compare Cloudflare's imported list against
   the block above, line for line. Cloudflare's scanner has no zone-transfer
   access — it guesses at names — and the records it is most likely to miss are
   the ones nothing links to, which is exactly what MX and TXT are.
4. Only now: Porkbun → Authoritative Nameservers → the two Cloudflare gave you.
5. Wait for the zone to read **Active**.
6. Re-check mail. Send yourself one, from outside.
7. Re-enable DNSSEC, this time from Cloudflare's DNS → Settings pane, which
   hands you a DS record to paste back at Porkbun.

**Then, and only then, the game's address**

A Worker route fires only on traffic Cloudflare is proxying. That is the whole
decision:

| | `gachichio.org/dovefallgame/` | `play.gachichio.org` |
|---|---|---|
| Needs | the root A record **orange-clouded** | its own record, created by Cloudflare |
| Means | every request to your site now goes through Cloudflare | the root A record stays grey and behaves exactly as today |
| Blast radius | your live site's TLS, caching and error pages all change hands | none |

**Take the subdomain.** It is a Worker Custom Domain — Workers & Pages →
dovefall-site → Settings → Domains & Routes → Add → Custom Domain — and
Cloudflare creates the record and issues the certificate itself. Your existing
site is not touched, not proxied, and cannot be affected by anything the game
does.

If you want the path form later, that is a separate, deliberate change on a day
when breaking the main site would be survivable — and when you make it, set
SSL/TLS to **Full (strict)**, never Flexible.

Then, whichever you chose:

```bash
# site/wrangler.toml → uncomment ONE routes block, or use the dashboard
cd site && npx wrangler deploy

# worker/wrangler.toml → add the new origin to ALLOWED_ORIGINS
cd ../worker && npx wrangler deploy
```

> The game shares whatever address it is served from — `SHARE_URL` reads
> `location`, not a constant — so nothing in the bundle needs rebuilding when
> the address changes, and a share link can never point somewhere the game
> is not.

---

### 6d · Payments — the Paystack journey, end to end

Money is the one path where a silent failure costs somebody something, so this
is written as the order to do it in, not as a list of settings.

**Which key.** The secret key, and only the secret key, as
`PAYSTACK_SECRET_KEY` (§3). It is never sent anywhere — the Worker uses it
locally, to recompute the HMAC-SHA512 of the raw webhook body and compare it
with the `x-paystack-signature` header. The public key belongs to Paystack's
inline checkout widget; Dovefall opens a hosted payment page instead, so it has
nothing to do and belongs nowhere in this project.

**IP allowlisting: leave it off.** That setting restricts which IPs may call
*the Paystack API* using your secret key. This Worker never calls the Paystack
API — traffic goes the other way, Paystack to us — so an allowlist protects
nothing here. It would, however, break the first time anything in this project
does call Paystack, because a Cloudflare Worker has no stable egress IP to add.
The webhook direction is already authenticated, by the signature.

**The custom field is the part that actually matters.**

`extractPayCode` (worker/src/paystack.js) looks for the player's code in
`metadata.player_code`, or in `metadata.custom_fields` at the entry whose
`variable_name` is `player_code`. It does **not** read a free-text payment note,
because a hosted page does not send one.

So the payment page at `PAYSTACK_LINK` must collect a custom field whose
variable name is exactly `player_code`. Without it, every payment arrives,
verifies, is recorded — and lands as `no_player`. The money is taken and no
hearts appear. Paystack Dashboard → Payment Pages → your page → Custom fields
→ add one, field name anything a human would understand ("Your Dovefall code"),
**variable name `player_code`**.

**In order:**

1. **Test mode.** Dashboard toggle to Test. Set the test secret key:
   `npx wrangler secret put PAYSTACK_SECRET_KEY` (`sk_test_…`).
2. **Webhook URL**, in the Test section of Settings → API Keys & Webhooks:
   `https://dovefall-api.bgkaranja.workers.dev/v1/paystack/webhook`
   (or your custom API domain, once §6c is done).
3. **Payment page**, in test mode, with the `player_code` custom field. Put its
   URL in `worker/wrangler.toml` → `PAYSTACK_LINK` and redeploy.
4. **Pay yourself.** Open the game → Settings → Respawns, copy the code, tap Pay
   with Paystack, use a Paystack test card, paste the code into the custom field.
5. **Check all three places**, because each proves a different link in the chain:

```bash
# Paystack delivered and we accepted it — 200, not 401 or 503
#   Dashboard → Settings → API Keys & Webhooks → recent webhook attempts

# We matched it to a player and credited
npx wrangler d1 execute dovefall --remote \
  --command "SELECT reference, status, amount, currency FROM payments ORDER BY rowid DESC LIMIT 5"

# and the hearts exist
npx wrangler d1 execute dovefall --remote \
  --command "SELECT name, pay_code, respawns FROM players WHERE respawns > 0"
```

   `status` tells you which link broke: `credited` is success; `no_player` means
   the custom field did not arrive or the code was mistyped; `below_min` means
   the amount was under `RESPAWN_MIN_SUBUNITS`.

6. **Go live.** Repeat 1–3 with the live key, the live webhook URL and a live
   payment page — they are separate settings in Paystack, and a live payment
   against a test webhook goes nowhere. Then pay yourself KES 50 for real and
   run the three checks again. That receipt is the only proof that matters.

A payment is credited exactly once: `payments.reference` is unique, and a
repeat delivery of the same reference is recorded as a duplicate and ignored.
Paystack retries on any non-200, which is why the handler answers 200 to
anything validly signed, even when it cannot match a player — a retry loop
would not find one either.

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
| Everything | Rebuild `game/` with `VITE_API_BASE=` (empty, explicit — see §5) then `npm run sync && npx wrangler deploy` — the game plays offline with no server at all | ~2 min |
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

**`d1 migrations apply` says "No migrations present".**
`migrations_dir = "schema"` is missing from the `[[d1_databases]]` block in
`worker/wrangler.toml`. Wrangler defaults to a folder called `migrations/`;
ours is `schema/`, because the test harness reads the same files. Pull the
latest — a test now asserts the config and the directory agree.

**The API is deployed but every request touching data fails.**
Almost certainly the migrations never ran. Count the tables with the query in
§6a — not `wrangler d1 list`, whose `num_tables` reads 0 either way. Applying
them needs no redeploy; the Worker code is unchanged.

**`d1 migrations apply` fails with `duplicate column name`.**
The ledger and the database disagree: the schema is already there, but
`d1_migrations` does not know it. This happens when the SQL was ever applied
outside wrangler. `0001_init.sql` is all `CREATE TABLE IF NOT EXISTS`, so it
succeeds trivially against a populated database and gets recorded as applied;
`0002` then does a bare `ALTER TABLE ... ADD COLUMN`, which SQLite cannot make
conditional, and hard-fails on a column that is already present.

Check what is at stake before touching anything:

```bash
npx wrangler d1 execute dovefall --remote --command \
  "SELECT (SELECT COUNT(*) FROM players) players, (SELECT COUNT(*) FROM bests) bests, (SELECT COUNT(*) FROM payments) payments;"
```

**All zero** — reset. It is the only route that leaves the schema verified
against the files rather than assumed. Children before parents, or the foreign
keys refuse:

```bash
npx wrangler d1 execute dovefall --remote --command \
  "DROP TABLE IF EXISTS d1_migrations; DROP TABLE IF EXISTS ops; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS rejects; DROP TABLE IF EXISTS saves; DROP TABLE IF EXISTS daily; DROP TABLE IF EXISTS bests; DROP TABLE IF EXISTS devices; DROP TABLE IF EXISTS players;"

npx wrangler d1 migrations apply dovefall --remote
```

**Not zero** — stop and take a backup (§10) first. The alternative is
hand-inserting the missing rows into `d1_migrations`, which leaves you trusting
that the schema matches the files instead of knowing it.

**A payment did not credit.**
Check the Paystack dashboard for a delivered webhook. The endpoint verifies an
HMAC-SHA512 signature, so a wrong `PAYSTACK_SECRET_KEY` shows as a delivered
webhook with a 401. Fix the secret and use Paystack's "resend" button.

---

## 10 · Backup and restore

Two mechanisms, for two different failures. Neither has been drilled yet —
this database is days old — so treat both as **untested until the first real
run**, and log that run's date here once it happens.

**Time Travel — the platform's own safety net, no setup required.** Every D1
database keeps a 30-day rolling history of every write. It is not a backup you
manage; it exists whether or not this section did.

```bash
# What the database looked like at a timestamp or a specific point
npx wrangler d1 time-travel info dovefall --remote

# Roll the WHOLE database back to just before a bad migration or a bad query.
# This is a full restore, not a per-row undo — everything written after the
# bookmark is gone.
npx wrangler d1 time-travel restore dovefall --remote --timestamp=<ISO-8601>
```

**A manual export — before anything destructive.** Every step in §9 that says
"stop and take a backup first" means this:

```bash
npx wrangler d1 export dovefall --remote --output="dovefall-$(date +%Y%m%d-%H%M%S).sql"
```

That file is a full SQL dump — schema and every row, players' names and
recovery-code hashes included. Treat it exactly like the database itself: not
committed, not emailed, deleted once the operation it was insurance for has
been confirmed safe.

**The drill.** Time Travel needs no drill — Cloudflare runs it. The export
does: run the command above once, confirm the file is non-empty and contains
`INSERT INTO players`, delete it, and write the date here.

```
Last export drill: (none yet — first live drill still owed)
```

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
