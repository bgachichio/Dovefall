# Dovefall — deployment

Everything on Cloudflare's free plan. The only thing outside it is the domain,
`gachichio.org`, which you already own.

Three deployables, three URLs:

| | What | Where |
|---|---|---|
| `worker/` | The API — accounts, scores, saves, payments | `dovefall-api.<sub>.workers.dev` |
| `site/` | The game bundle, as static assets | `gachichio.org/dovefallgame/` |
| D1 `dovefall` | The database | already created |

**Read §0 before you start.** One step in here changes DNS for a domain that
currently serves live traffic, and it is the only step that can take your site
down. It is also the last step, deliberately.

---

## 0 · What is already done, and what can go wrong

The database exists on your account and carries every migration:

| | |
|---|---|
| Database | `dovefall` · `b0aa203a-2e22-466c-b0b2-a9013956608f` · WEUR |
| Tables | `players` `devices` `bests` `daily` `saves` `rejects` `payments` `ops` |
| Migrations | `0001` init · `0002` identity · `0003` respawns · `0004` devices · `0005` streaks · `0006` ops |

**The one honest caveat.** There is no Godot in the environment this was built
in. The Worker is exhaustively tested — 130 tests, including 60 end-to-end
against the real schema — but **no GDScript has ever been compiled**. Roughly
900 lines are new. Budget half an hour at §5 for compile errors; they will be
trivial and the editor will name every one.

**The riskiest step is §8**, the DNS move. Everything before it is additive and
reversible in under a minute. Do §1–§7 whenever you like; do §8 when you have a
calm hour and are not about to go to bed.

---

## 1 · Prerequisites

```bash
node --version          # 22 or newer
cd dovefall/worker
npm install
npm test
```

**You should see** `# pass 130`, `# fail 0`.

One test matters more than the rest:

```
ok NN - determinism checksum matches the Godot build
```

That asserts the server's port of `Rng.gd` reproduces **4075699207** — the
number your runbook's Gate 9 requires the Pixel and the desktop to agree on.
**If it ever fails, stop.** The server and the game no longer share a physics,
and every seed-derived claim the API makes is void.

Godot **4.7.2** is current (18 August 2026) and the project already targets the
4.7 line (`config/features` declares `"4.7"`). Use 4.7.2 or later.

---

## 2 · Authenticate

```bash
npx wrangler login
npx wrangler whoami
```

**You should see** your account name and ID.

---

## 3 · Secrets

Never in `wrangler.toml`, never in git. `wrangler secret put` prompts and stores
them encrypted at Cloudflare.

```bash
# 32 random bytes. Rotating this signs every player out — which is also your
# panic button if a session token is ever leaked.
openssl rand -base64 32
npx wrangler secret put SESSION_SECRET       # paste the above

# Your Paystack SECRET key (sk_test_… first, sk_live_… when you go live). It
# signs every webhook; without it the payments endpoint refuses to trust
# anything at all.
npx wrangler secret put PAYSTACK_SECRET_KEY

# Optional. Comma-separated Google OAuth client IDs, for when you wire
# sign-in. Guest play — which is every player on day one — works without it.
npx wrangler secret put GOOGLE_CLIENT_IDS
```

```bash
npx wrangler secret list
```

**You should see** the names, and no values.

> On Android, `requestIdToken(serverClientId)` issues a token whose `aud` is
> the **web** client ID, not the Android one. If sign-in ever returns
> `bad_audience`, that is nearly always why.

---

## 4 · Deploy the API

```bash
npx wrangler deploy
```

**You should see** a `https://dovefall-api.<subdomain>.workers.dev` URL, and a
line confirming the cron trigger `0 * * * *`. Keep the URL; call it `$API`.

### Smoke test — the API, before the game exists

```bash
API=https://dovefall-api.<subdomain>.workers.dev
curl -s $API/v1/health | python3 -m json.tool
```

**You should see** `"ok": true`, today's date, the four modes, and a `budget`
block reporting `"shedding": false` with `"threshold_pct": 80`.

```bash
# A guest signs in
TOKEN=$(curl -s -X POST $API/v1/auth/guest -H 'content-type: application/json' \
  -d '{"device_id":"11111111-2222-3333-4444-555555555555","name":"Smoke"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

# A plausible run is accepted
curl -s -X POST $API/v1/runs -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"mode":"normal","score":30,"duration_ms":60000,"seed":"D0FE","build":"0.1.0","playfield_h":1920}'
```

**You should see** `"accepted":true,"personal_best":true` and a `streaks` block
showing `"outcome":"started"`.

```bash
# An impossible one is not, and it says what IS possible
curl -s -X POST $API/v1/runs -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"mode":"normal","score":900,"duration_ms":30000,"seed":"D0FE"}'
```

**You should see** HTTP 422, `"reason":"too_fast"`, and a message naming the
highest score 30 seconds could support.

```bash
curl -s $API/v1/board/normal      # Smoke at rank 1, with a #TAG
curl -s $API/v1/board/streaks     # the persistence board
```

Then clear the test data — the `players` delete cascades everywhere:

```bash
npx wrangler d1 execute dovefall --remote --command \
  "DELETE FROM players WHERE name = 'Smoke'; DELETE FROM rejects;"
```

---

## 5 · Apply the game patches

From the **Godot project** root:

```bash
git apply --stat ../skills/dovefall/godot/patches/*.patch    # review first
git apply        ../skills/dovefall/godot/patches/*.patch

cp ../skills/dovefall/godot/autoload/Net.gd  autoload/
cp ../skills/dovefall/godot/ui/*.gd          ui/
mkdir -p tools && cp ../skills/dovefall/godot/tools/*.gd tools/
```

| Patch | Change |
|---|---|
| `project.patch` | Registers the `Net` autoload **and sets `stretch/aspect="keep"`** — the fix that makes every screen render the identical game. Without it the game is broken in landscape. See `patches/07-playfield-fairness.md`. |
| `scripts-Game.patch` | Flap on the physics tick + replay log; the ♥ respawn band; the interactive tutorial; the streak glyph on the death panel; letterbox tinted to the sky. |
| `autoload-SaveData.patch` | Per-install id (`OS.get_unique_id()` is empty on Web), a `rev` counter, and `merge_remote()` — the conflict-free cloud-save merge. |
| `autoload-AppState.patch` | Syncs the save on pause, which is how a session ends. |
| `autoload-Config.patch` | New strings, English and Swahili. **The Swahili was written by an agent, not a speaker — check it before the Swahili build ships.** |
| `ui-UiKit.patch` | Text fields, **and touch targets raised to the design.md 8.2 floor** — every button measured 27–40 CSS px on a phone against a 44/48 px minimum. |
| `ui-*.patch` | The Credits button, the account entry point. |
| `scripts-Main.patch` | Routing: leaderboard, respawn shop, first-play tutorial gate. |

Then set two constants in `autoload/Net.gd`:

```gdscript
const API_BASE  := "https://dovefall-api.<subdomain>.workers.dev"
const SHARE_URL := "https://gachichio.org/dovefallgame"
```

> Leaving `API_BASE` as `""` is a valid state: the game plays exactly as before,
> entirely offline. That is your fastest rollback and it needs no server.

**You should see** the project open with **no `SCRIPT ERROR`** in the import
log, and on boot:

```
[dovefall] checksum     : 4075699207
```

---

## 6 · Validate the gameplay

Do this on the desktop first, then repeat the starred steps on the Pixel. Every
line is a thing that has broken in this codebase or could.

### 6a · Rendering — the one to do on three screen shapes

| # | Do | Expect |
|---|---|---|
| 1 | Launch, resize the window to a wide landscape shape | The game stays a **portrait column**, centred, with bars either side |
| 2 | Watch the bars as you pass score 5, 15, 30 | Bars **change colour with the sky** at each chapter — they are not black |
| 3 | Resize while a run is in progress | Gates do not jump. The course is unchanged |
| 4 | ★ On the Pixel, check the top-left counters | Best and feather counters are **clear of the status bar and punch-hole** |
| 5 | ★ On a tablet or a 4:3 window | Portrait column again, bars left and right |
| 6 | ★ On the smallest phone you can find, tap every menu button | Nothing needs a second attempt. Buttons are 140 design units — 48+ CSS px even at 375 px wide |

**The determinism check.** Add a temporary print of the first three gate `top`
values for seed `0xD0FE` in `normal`, then read it on desktop, on the Pixel, and
in a resized browser window. **All three must be identical.** Before the
`aspect="keep"` fix they were not — a 20:9 phone got 76% more placement range
and a laptop got a negative one. Delete the print afterwards.

### 6b · The first-run tutorial

| # | Do | Expect |
|---|---|---|
| 1 | Delete the save (`user://` — Project ▸ Open User Data Folder), relaunch, tap **Play** | The **name screen** appears with three suggestions |
| 2 | Tap a suggested name | It saves and a run begins immediately |
| 3 | Fly and die once | A **gold arrow pulses** at the ♥ band holding one free respawn |
| 4 | Tap the ♥ | The sky ahead clears, a countdown runs, the flight continues |
| 5 | Die again | The **"Well flown"** screen: your score, a Share button, a line about the recovery code |
| 6 | Tap Play | Straight into a normal run — the tutorial never appears again |

### 6c · Interruption and persistence

| # | Do | Expect |
|---|---|---|
| 1 | ★ Background the app mid-run | It pauses. Returning gives a **countdown, not a death** |
| 2 | Change a setting, force-close from recents, reopen | The setting persisted |
| 3 | Reach 5, 15, 30 | Palette cross-fades; music lifts to major |
| 4 | Tap repeatedly | Wings animate; audio fires **on the tap**, not a frame later |

### 6d · Accounts, scores, streaks

| # | Do | Expect |
|---|---|---|
| 1 | Settings ▸ Account | Your name and `#TAG` |
| 2 | Set a name, reopen | It stuck |
| 3 | **Get a recovery code** | 15 characters, `XXXXX-XXXXX-XXXXX`, copied to clipboard |
| 4 | Score a run, open **Leaderboard** | You are on it, **your row in gold** |
| 5 | Switch to the **Streak** board | It loads |
| 6 | Title screen | A streak line: `Streak: 1 days` |
| 7 | `curl -s $API/v1/board/normal` | Your real score, from the real device |

**Cross-device, the one worth doing properly:** get a recovery code on the
phone, enter it in the browser build. The browser should show **the phone's
scores and streak**, and the phone should be signed out. Then check
`curl -s $API/v1/devices -H "authorization: Bearer …"` shows two devices —
a third would evict the oldest.

### 6e · Payments (test mode first)

| # | Do | Expect |
|---|---|---|
| 1 | Die with 0 respawns; tap the empty ♡ | The **shop** opens with an 8-character player code |
| 2 | Tap **Pay with Paystack** | The code is copied; the hosted page opens |
| 3 | Pay KES 50+ in test mode with the code in **Player code** | Webhook fires |
| 4 | Back in the game, tap **I have paid** | Balance shows **♥ 3** |
| 5 | Die, tap the ♥ | Run continues; balance drops to 2 |
| 6 | Finish that run and check the board | The score is **not ranked** — continued runs earn feathers, never rank |

### 6f · Offline

Turn off the network entirely.

| # | Do | Expect |
|---|---|---|
| 1 | Play a full run | Plays perfectly. No hang, no error |
| 2 | Reconnect, play again | The queued run appears on the board |

**This is the acceptance bar: the game is never worse offline than it was
before there was a server.**

---

## 7 · Web export and the bundle

In Godot: **Project ▸ Export ▸ Add ▸ Web**.

| Setting | Value | Why |
|---|---|---|
| Export Type / Threads | **OFF** | Single-threaded is the Godot 4.3+ default. Threads need `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` isolation, which **blocks embedding the game in any page carrying third-party frames** — H5 Games Ads, itch.io, a portal — and Dovefall spawns no threads. It is a fixed-step 2D game. Threads buy nothing and cost the ad surface. |
| Export path | `web/index.html` | Anything else and the folder URL 404s. |
| `exclude_filter` | `store/*` | 144 KB of Play listing artwork no player ever sees. |

```bash
cd ../skills/dovefall/site
mkdir -p public/dovefallgame
cp -r ../../../<godot-project>/web/* public/dovefallgame/
npm run verify
```

**You should see** a file listing, an uncompressed and an over-the-wire size,
and `Single-threaded export — no COOP/COEP headers needed anywhere.`

The preflight **blocks the deploy** on: a threaded export, an entry file that
is not `index.html`, an absolute path that would 404 under `/dovefallgame/`, or
a missing engine. Each of those ships a page that loads and then does nothing.

**Write the over-the-wire number down.** It is the one input to the cost model
that was estimated rather than measured, and everything about bandwidth follows
from it.

```bash
npm run deploy          # verify, then wrangler deploy
```

**You should see** a `https://dovefall-site.<subdomain>.workers.dev` URL, with
the game at **`/dovefallgame/`**. Close the CORS loop:

```bash
# worker/wrangler.toml → ALLOWED_ORIGINS, add the site URL
cd ../worker && npx wrangler deploy
```

**You should see** the game load in a browser, play, and a score appear in
`curl -s $API/v1/board/normal`. A CORS error in the console names the origin it
wanted; put that exact string in `ALLOWED_ORIGINS`.

**At this point the game is live and shareable.** Everything below is the
address bar.

---

## 8 · Putting it on gachichio.org

This is the only step that touches a domain already serving live traffic. Do it
when you have a calm hour, not at the end of a long night.

**The trap to avoid first.** Do **not** have Caddy `reverse_proxy` the game.
Every byte would flow out of africa-south1 at $0.12/GB — roughly **$72/month at
100,000 web players**, the exact bill this architecture exists to avoid.

Both options below need `gachichio.org` on Cloudflare DNS: a Worker route can
only fire on a hostname whose traffic actually reaches Cloudflare. The choice
between them is about **blast radius**, not about avoiding the DNS move.

### Common to both

1. Add `gachichio.org` to Cloudflare (free plan). It imports your DNS.
2. **Check every imported record against your current zone before switching.**
   Anything missed becomes an outage of that service — Kenya Pulse included.
3. Change the nameservers at your registrar. Usually under an hour; sometimes
   far longer.

### A · The path — `gachichio.org/dovefallgame/`

What we agreed, and the URL already baked into `Net.SHARE_URL`.

4. Set the root A record (`34.35.177.164`) to **Proxied** — the orange cloud.
   Load-bearing: a grey-cloud record makes the Worker route **fail silently**.
5. SSL/TLS **Full**, not Flexible — Flexible sends plaintext to your origin. If
   Caddy's Let's Encrypt renewal starts failing behind the proxy, install a
   **Cloudflare Origin Certificate** on the VM and move to Full (strict).
6. Uncomment routing block **A** in `site/wrangler.toml`, then `npx wrangler deploy`.

**The cost of this option:** every request to gachichio.org now passes through
Cloudflare on its way to Caddy. That is normal and usually an improvement, but
it is a change to how your whole site is served, not just the game.

### B · The subdomain — `dovefall.gachichio.org/dovefallgame/`

4. Add a **CNAME** `dovefall` → your `workers.dev` hostname. Leave the root A
   record **grey-cloud**, pointing at the VM exactly as it does now.
5. Uncomment routing block **B** in `site/wrangler.toml`, then `npx wrangler deploy`.
6. Change `Net.SHARE_URL` to match, and re-export.

**The advantage:** the root domain is untouched. A traffic spike on the game
cannot reach the origin serving Kenya Pulse, because it never resolves there.
If you want the safest possible first week, take this and move to the path
later — the bundle is identical, only the route line differs.

**You should see**, either way, the game at its URL and every other path on
gachichio.org served by Caddy exactly as before.

**Rollback:** comment the route out and redeploy, or set the A record back to
grey cloud. Under a minute, and neither touches the VM.

---

## 9 · Paystack

Three one-time steps in the [dashboard](https://dashboard.paystack.com):

1. **Payment page** `paystack.shop/pay/dovefall` — add a custom field named
   **Player code** (variable `player_code`). The webhook parser also accepts
   the code from any custom field, so an imperfect name still credits.
2. **Webhook URL** → `$API/v1/paystack/webhook`. Test mode first.
3. **Amount** can stay open. The server credits **3 respawns for any KES
   payment of 50.00 or more** (`RESPAWN_MIN_SUBUNITS`, in cents). Below the
   floor, or another currency, the payment is **recorded but not credited** —
   the `payments` table is your audit trail for "I paid and got nothing",
   including the code the payer actually typed.

Smoke-test the webhook against production with a signed fake:

```bash
SECRET=sk_test_your_key
CODE=$(curl -s $API/v1/respawns -H "authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["pay_code"])')

BODY='{"event":"charge.success","data":{"reference":"smoke_pay_1","amount":5000,"currency":"KES","metadata":{"custom_fields":[{"display_name":"Player code","variable_name":"player_code","value":"'$CODE'"}]}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha512 -hmac "$SECRET" | awk '{print $NF}')

curl -s -X POST $API/v1/paystack/webhook \
  -H "content-type: application/json" -H "x-paystack-signature: $SIG" -d "$BODY"
```

**You should see** `{"received":true,"status":"credited","duplicate":false}`,
and `/v1/me` now reporting `"respawns": 3`. Replay the same curl: `duplicate:
true` and the balance **stays** 3. Clean up:

```bash
npx wrangler d1 execute dovefall --remote --command \
  "DELETE FROM payments WHERE reference = 'smoke_pay_1'"
```

---

## 10 · Staying inside the free plan

An **hourly cron** (`0 * * * *`, one of your five free triggers) prunes expired
rows and records the day's projected usage. Hourly rather than nightly on
purpose: a nightly job tells you that you blew the budget yesterday, which is a
post-mortem, not a guard.

**How it measures without spending what it measures.** A counter incremented on
every write would double the write cost. Instead the cron counts rows by
timestamp — reads are the abundant budget, 5,000,000/day against 100,000
writes — and extrapolates. That is 24 writes a day to watch 100,000.

**What happens at 80%.** The Worker sheds writes a player would not notice and
keeps the ones they would:

| Shed at 80% | Never shed |
|---|---|
| Reject logging | Scores and personal bests |
| Last-seen touches | Daily board entries |
| Cloud saves (window widens 30s → 300s) | Streaks |

Degradation, not an outage. Check it any time:

```bash
curl -s $API/v1/health | python3 -m json.tool
```

**You should see** `budget.shedding: false` and every `pct` well under 80.

Retention: `daily` 35 days · `rejects` 30 · `payments` 400 (real money keeps a
year-plus audit trail) · `ops` 90. **`bests` is never pruned** — a personal best
is the point of the game.

**Software currency.** Workers is serverless: there is no OS to patch. The
equivalents are `compatibility_date` in `wrangler.toml` (raise it deliberately,
never automatically — it changes runtime behaviour) and the one dev dependency,
`wrangler`. `.github/renovate.json` opens a batched PR on Mondays and raises
security patches immediately; `.github/workflows/ci.yml` runs the suite on every
push **and weekly**, so a runtime change that breaks us is found by CI rather
than a player.

---

## 11 · Backups — not optional

This database is the only copy of every player's identity, progress and streak.
Losing it loses all of it, and unlike the game itself, it cannot be rebuilt.

```bash
# Nightly, on the Lenovo
npx wrangler d1 export dovefall --remote --output "dovefall-$(date +%F).sql"
gzip "dovefall-$(date +%F).sql"
```

Three copies: the Lenovo, an external disk, Backblaze B2. Under 100 MB, so free.

**Then restore one into a scratch database and query it.** An untested backup is
a rumour. Log the drill here:

| Drill | Date | Result |
|---|---|---|
| 1 | _pending_ | |

---

## 12 · Rollback

Every layer rolls back independently:

```bash
npx wrangler deployments list && npx wrangler rollback     # either Worker
```

For the game itself, `API_BASE := ""` returns the build to pure local play.
That is the fastest rollback you have and it needs no server at all.

The database has no rollback. See §11.

---

## What this deployment does not do

Stated plainly so nobody assumes otherwise later:

- **It does not replay runs.** It checks that a score is arithmetically
  possible for its duration, which catches crude attacks and nothing subtle.
  The replay log is captured and stored from day one, so historical runs become
  checkable the day a validator lands — but none ships until
  `tools/golden_vectors.gd` has run under a real Godot build and the JavaScript
  port is proven against it. An unverified validator is worse than none,
  because it is believed.
- **It does not wire Google sign-in in the game.** The endpoints and the token
  verification are built and tested; the platform call that obtains an ID token
  is not. Guest play covers the whole loop.
- **The Android build has no share sheet.** Godot has none built in. On web the
  real share sheet opens with the image; elsewhere the card is saved and the
  link copied. `ShareCard.gd` marks where the plugin call goes.
