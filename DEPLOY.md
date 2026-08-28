# Dovefall — deploy

Accounts, cloud save and leaderboards on Cloudflare's free plan. The 1 GB VM is
not involved and never becomes involved.

About forty minutes. Every step ends with **You should see**.

---

## What is already done

The D1 database exists on your account and carries the schema:

| | |
|---|---|
| Database | `dovefall` |
| ID | `b0aa203a-2e22-466c-b0b2-a9013956608f` |
| Primary region | WEUR (Amsterdam) |
| Tables | `players`, `devices`, `bests`, `daily`, `saves`, `rejects`, `payments` |
| Migrations applied | `0001` init · `0002` identity · `0003` respawns · `0004` devices · `0005` streaks |

`worker/wrangler.toml` already points at it. Nothing below re-creates it.

---

## 0 · Prerequisites

```bash
node --version     # 20 or newer
cd dovefall/worker
npm install
npm test
```

**You should see** `# pass 116`, `# fail 0`.

One test matters more than the rest:

```
ok NN - determinism checksum matches the Godot build
```

That asserts the server's port of `Rng.gd` reproduces `4075699207` — the number
runbook Gate 9 requires your Pixel and your desktop to agree on. **If it ever
fails, do not deploy.** The server and the game no longer share a physics, and
every seed-derived claim the API makes is void.

---

## 1 · Authenticate wrangler

```bash
npx wrangler login
npx wrangler whoami
```

**You should see** your account name and ID.

---

## 2 · Set the secrets

Never in `wrangler.toml`, never in git. `wrangler secret put` prompts and stores
them encrypted at Cloudflare.

```bash
# 32 random bytes. Rotating this signs every player out — which is also your
# panic button if a session token is ever leaked.
openssl rand -base64 32
npx wrangler secret put SESSION_SECRET      # paste the above

# Comma-separated OAuth client IDs. One for web (Google Identity Services), one
# for Android (Play Games / Google Sign-In). Leave unset until you wire sign-in;
# guest play works without it.
npx wrangler secret put GOOGLE_CLIENT_IDS

# Your Paystack SECRET key (sk_test_… first, sk_live_… when you go live).
# It signs every webhook; without it the payments endpoint refuses to trust
# anything. Rotating it at Paystack means re-running this command.
npx wrangler secret put PAYSTACK_SECRET_KEY
```

```bash
npx wrangler secret list
```

**You should see** all three names, and no values.

> On Android, `requestIdToken(serverClientId)` issues a token whose `aud` is the
> **web** client ID, not the Android one. If sign-in returns `bad_audience`,
> that is nearly always why.

---

## 3 · Deploy the Worker

```bash
npx wrangler deploy
```

**You should see** a `https://dovefall-api.<subdomain>.workers.dev` URL. Keep it.

---

## 4 · Smoke test, against production

```bash
API=https://dovefall-api.<subdomain>.workers.dev

curl -s $API/v1/health
```

**You should see** `{"ok":true,"version":"1.0.0","day":"…","modes":["easy",…]}`

```bash
# A guest signs in
TOKEN=$(curl -s -X POST $API/v1/auth/guest \
  -H 'content-type: application/json' \
  -d '{"device_id":"11111111-2222-3333-4444-555555555555","name":"Smoke"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
echo ${TOKEN:0:12}…

# A plausible run is accepted
curl -s -X POST $API/v1/runs -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"mode":"normal","score":30,"duration_ms":60000,"seed":"D0FE","build":"0.1.0","playfield_h":1920}'
```

**You should see** `{"accepted":true,"personal_best":true,"daily_best":false}`

```bash
# An impossible one is not
curl -s -X POST $API/v1/runs -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"mode":"normal","score":900,"duration_ms":30000,"seed":"D0FE"}'
```

**You should see** `{"accepted":false,"reason":"too_fast",…}` with HTTP 422.

```bash
curl -s $API/v1/board/normal
```

**You should see** `Smoke` at rank 1.

Then clear the test data:

```bash
npx wrangler d1 execute dovefall --remote \
  --command "DELETE FROM players WHERE name = 'Smoke'"
npx wrangler d1 execute dovefall --remote \
  --command "DELETE FROM rejects"
```

The `players` delete cascades to `bests`, `daily` and `saves`.

---

## 5 · Apply the game patches

From the Godot project root:

```bash
git apply --stat  ../skills/dovefall/godot/patches/*.patch   # review first
git apply         ../skills/dovefall/godot/patches/*.patch
cp ../skills/dovefall/godot/autoload/Net.gd autoload/Net.gd
mkdir -p tools && cp ../skills/dovefall/godot/tools/golden_vectors.gd tools/
```

What the patches do:

| Patch | Change |
|---|---|
| `scripts-Game.patch` | Flap on the physics tick + replay log (as before), and now: the ♥ band on the death panel (filled = respawns held, empty = opens the shop), the interactive tutorial (one free respawn, a pulsing arrow, ends on the second death), and `respawn_used` on every submission. Tutorial runs never leave the device. |
| `autoload-SaveData.patch` | `OS.get_unique_id()` returns an empty string on Web, which gave every browser player the shared key `"dovefall-"`. Replaced with a per-install id. **On Android the native id is reused verbatim, so existing saves still decrypt.** |
| `export_presets.patch` | Excludes `store/*` — 144 KB of Play listing artwork that no player sees. |
| `project.patch` | Registers the `Net` autoload, **and changes `stretch/aspect` from `expand` to `keep`** — the fix that makes every screen render the identical game. See `patches/07-playfield-fairness.md`; without it the game is broken in landscape. |
| `ui-UiKit.patch` | Adds `field()` and `field_display()` — the only places a player types. |
| `autoload-Config.patch` | Twenty-three new strings, English and Swahili. **The Swahili was written by an agent, not a speaker — check it before the Swahili build ships.** |
| `ui-TitleScreen.patch` | A Credits button beside Leaderboard. |
| `ui-SettingsScreen.patch` | An account entry point in the existing Account section. |
| `scripts-Main.patch` | Routing: leaderboard, respawn shop (returns to the dead run on close), and the first-play tutorial gate — name pick → tutorial run → closing screen → the run they asked for. |

Two new screens are whole files, not patches — copy them in:

```bash
cp ../skills/dovefall/godot/ui/CreditsScreen.gd       ui/
cp ../skills/dovefall/godot/ui/IdentityScreen.gd      ui/
cp ../skills/dovefall/godot/ui/LeaderboardScreen.gd   ui/
cp ../skills/dovefall/godot/ui/RespawnScreen.gd       ui/
cp ../skills/dovefall/godot/ui/ShareCard.gd           ui/
cp ../skills/dovefall/godot/ui/TutorialNameScreen.gd  ui/
cp ../skills/dovefall/godot/ui/TutorialEndScreen.gd   ui/
```

Also confirm two constants in the copied files before export:

- `Net.API_BASE` — your Worker URL (below).
- `Net.SHARE_URL` — the link every share card carries. It is set to
  `https://gachichio.org/dovefallgame`, which only works once §7a is done.
  **For tonight, set it to your `workers.dev` URL instead** — a share card
  pointing at a 404 is worse than one with an ugly hostname.

Then set the API base in `autoload/Net.gd`:

```gdscript
const API_BASE := "https://dovefall-api.<subdomain>.workers.dev"
```

Leaving it `""` is a valid state: the game plays exactly as before, entirely
offline. That is the fallback if anything below goes wrong.

**Screen independence is now fixed** (`patches/07-playfield-fairness.md`), so
the board is fair by construction. Verify it on device with the check in that
file: the first three gate heights for a fixed seed must match on the Pixel, on
the desktop, and in a resized browser window.

**You should see** the project open with no `SCRIPT ERROR` in the import log,
and `checksum : 4075699207` on boot. These are ~100 lines of GDScript that have
never been run by the engine; budget twenty minutes for one or two trivial
compile errors, as the original runbook does.

---

## 6 · Web export

In Godot: **Project → Export → Add → Web**.

- **Leave "Extensions Support" off.** Single-threaded is the Godot 4.3+ default
  and needs no `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`
  headers, so the bundle is plain static files anywhere. Dovefall spawns no
  threads and loses nothing. It also keeps the option of embedding the game in
  a page alongside H5 Games Ads, which cross-origin isolation would forbid.
- Set `exclude_filter` to `store/*` here too.
- Export to `web/index.html`.

```bash
du -sh web/
```

**You should see** roughly 25–40 MB uncompressed, of which the `.wasm` is most.
Brotli takes it to about 5 MB on the wire — **write down the real number**, it
is the one input to the whole cost model that I estimated rather than measured.

---

## 7 · Publish the bundle

The bundle is served by a **second Worker** (`site/`) whose only job is static
assets. Static assets are unmetered on the free plan, which is the whole reason
the ~5 MB engine download does not come from the VM.

```bash
cd ../site
mkdir -p public/dovefallgame
cp -r ../../<godot-project>/web/* public/dovefallgame/
npx wrangler deploy
```

**You should see** a `https://dovefall-site.<subdomain>.workers.dev` URL. The
game is at **`/dovefallgame/`** on it — the trailing slash matters, and
`html_handling` adds it for you.

Now close the CORS loop, because the Worker refuses browser origins it does not
know:

```bash
# edit worker/wrangler.toml -> ALLOWED_ORIGINS, add the site URL
cd ../worker && npx wrangler deploy
```

**You should see** the game load, play, and a score appear in
`curl -s $API/v1/board/normal` after a run. A CORS error in the browser console
names the origin it wanted; put that exact string in `ALLOWED_ORIGINS`.

**This is a live, shareable game.** Everything below is about the address bar.

---

## 7a · Moving it to gachichio.org/dovefallgame

The game runs fine on `workers.dev`. Putting it on your own domain is a
separate, riskier job, and it is worth understanding what it touches before you
start — `gachichio.org` currently serves Kenya Pulse from Caddy on the VM.

**The trap to avoid.** Do NOT have Caddy `reverse_proxy` the game. Every byte
would then flow out of africa-south1 at $0.12/GB, which is roughly $72/month at
100,000 web players — the exact bill this whole architecture exists to avoid. A
302 redirect to the workers.dev URL is free and safe, but changes the address
bar, which defeats the point.

**The way that works.** Put the zone on Cloudflare and let a Worker route claim
one path:

1. Add `gachichio.org` to Cloudflare (free plan). It imports your existing DNS.
2. **Check the imported records against your current zone before switching.**
   Anything missed becomes an outage of that service, not of the game.
3. Change the nameservers at your registrar. Propagation is usually under an
   hour and can be far longer; do not start this at 11pm.
4. Set the root A record (`34.35.177.164`) to **Proxied** — the orange cloud.
   This is load-bearing: a Worker route cannot fire on a hostname whose traffic
   never reaches Cloudflare, and a grey-cloud record fails *silently*.
5. SSL/TLS mode **Full**, not Flexible. Flexible sends plaintext to your origin.
   Caddy's Let's Encrypt renewal uses an HTTP-01 challenge that the proxy can
   interfere with; if renewal starts failing, install a **Cloudflare Origin
   Certificate** on the VM and move to Full (strict).
6. Uncomment the `routes` block in `site/wrangler.toml` and `npx wrangler
   deploy`.

**You should see** `https://gachichio.org/dovefallgame/` serve the game, and
every other path on gachichio.org still served by Caddy exactly as before.

Then set `Net.SHARE_URL` to `https://gachichio.org/dovefallgame`, re-export,
and redeploy the site Worker. Until you do, every share card carries the old
link — which is why it is worth deciding the address before you invite anyone.

**Rollback:** comment the route out and redeploy, or set the A record back to
grey cloud. Both take under a minute and neither touches the VM.

---

## 7b · Wire Paystack

Three one-time steps in the [Paystack dashboard](https://dashboard.paystack.com):

1. **The payment page** — `paystack.shop/pay/dovefall`. Add a custom field
   named **Player code** (variable name `player_code`). The game shows each
   player an 8-character code and copies it to their clipboard before opening
   the page; this field is where they paste it. The webhook parser also
   accepts the code from any custom field, so an imperfect field name still
   credits.
2. **The webhook** — Settings → API Keys & Webhooks → Webhook URL:
   `https://dovefall-api.<subdomain>.workers.dev/v1/paystack/webhook`.
   Set it for test mode first, live mode when you switch keys.
3. **Amount** — the page can leave the amount open. The server credits
   **3 respawns for any KES payment of 50.00 or more** (`RESPAWN_MIN_SUBUNITS`
   in `wrangler.toml`, in cents). Below the floor, or in another currency, the
   payment is recorded in the `payments` table but grants nothing — that table
   is your audit trail for "I paid and got nothing", including the code the
   payer typed.

Smoke-test the webhook against production with a signed fake:

```bash
SECRET=sk_test_your_key            # the same one you gave wrangler
CODE=$(curl -s $API/v1/respawns -H "authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["pay_code"])')

BODY='{"event":"charge.success","data":{"reference":"smoke_pay_1","amount":5000,"currency":"KES","metadata":{"custom_fields":[{"display_name":"Player code","variable_name":"player_code","value":"'$CODE'"}]}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha512 -hmac "$SECRET" | awk '{print $NF}')

curl -s -X POST $API/v1/paystack/webhook \
  -H "content-type: application/json" -H "x-paystack-signature: $SIG" -d "$BODY"
```

**You should see** `{"received":true,"status":"credited","duplicate":false}` —
and `/v1/me` now shows `"respawns": 3`. Replay the same curl: `duplicate: true`
and the balance stays 3. Then clean up:

```bash
npx wrangler d1 execute dovefall --remote --command "DELETE FROM payments WHERE reference = 'smoke_pay_1'"
```

**On sharing, honestly:** the web build opens the real share sheet
(`navigator.share`, image included where the browser allows it — Chrome on
Android does). **The Android native build has no share sheet yet** — Godot has
no built-in one; until a share plugin is added, the card is saved and the link
is copied to the clipboard, and `ShareCard.gd` marks the slot where the plugin
call goes.

---

## 8 · Rollback

Every layer rolls back independently, in seconds:

```bash
npx wrangler deployments list                    # Worker
npx wrangler rollback [--message "why"]

npx wrangler pages deployment list --project-name dovefall
# promote an earlier deployment from the dashboard
```

For the game itself, `API_BASE := ""` in `Net.gd` disables every network call
and returns the build to pure local play. That is the fastest rollback you have
and it needs no server.

The database has no rollback. See §10.

---

## 9 · Watch the write budget

The free plan gives **100,000 D1 row-writes a day**, and an index costs an extra
write when its column is touched. The schema is built so that a run which does
not beat the player's stored best writes **nothing** — only a personal best, a
daily best, or a save sync touches disk.

```bash
npx wrangler d1 execute dovefall --remote --command \
  "SELECT (SELECT COUNT(*) FROM players) AS players,
          (SELECT COUNT(*) FROM bests)   AS bests,
          (SELECT COUNT(*) FROM rejects) AS rejects"
```

Watch `rejects` — it is the answer to "what does cheating actually look like
here", and it only fills when someone attempts a score that would have topped
their own best. If it stays empty, do not build the replay validator.

Other ceilings, for reference: 100,000 Worker requests/day, 10 ms CPU per
request, 5 GB D1 storage. At 300 bytes a player, storage will not bind before
anything else does.

---

## 10 · Backups — not optional

This database is now the only copy of every player's identity and progress.
Losing it loses every score, and unlike the game itself, scores cannot be
rebuilt. `developer.md` §8.5 mandates 3-2-1 and a restore drill every 90 days.

```bash
# On the Lenovo, nightly
npx wrangler d1 export dovefall --remote --output "dovefall-$(date +%F).sql"
gzip "dovefall-$(date +%F).sql"
```

Three copies: the Lenovo, an external disk, Backblaze B2. Under 100 MB, so free.

**Then restore one into a scratch database and query it.** An untested backup is
a rumour. Log the drill date in this file:

| Drill | Date | Result |
|---|---|---|
| 1 | _pending_ | |

---

## What this deployment does not do

Stated plainly so nobody assumes otherwise later:

- **It does not replay runs.** It checks that a score is arithmetically possible
  for its duration, which catches the crude attacks and nothing subtle. The
  replay log is captured and stored from day one, so historical runs become
  checkable the day a validator lands — but no validator ships until
  `tools/golden_vectors.gd` has been run under a real Godot build and the
  JavaScript port is proven against it. An unverified validator is worse than
  none, because it is believed.
- **It does not fix the playfield defect.** See `patches/07`.
- **It does not wire Google sign-in in the game.** The endpoints and the
  verification are built and tested; the platform-side call that obtains an ID
  token is not. Guest play works today and covers the whole loop.
