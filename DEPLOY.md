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
| Tables | `players`, `bests`, `daily`, `saves`, `rejects` |

`worker/wrangler.toml` already points at it. Nothing below re-creates it.

---

## 0 · Prerequisites

```bash
node --version     # 20 or newer
cd dovefall/worker
npm install
npm test
```

**You should see** `# pass 51`, `# fail 0`.

The first test is the one that matters:

```
ok 43 - determinism checksum matches the Godot build
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
```

```bash
npx wrangler secret list
```

**You should see** both names, and no values.

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
| `scripts-Game.patch` | Flap applies on the physics tick, not the input event. Records the tick index of every flap and submits the run on death. Audio feedback still fires on the input event — the 30 ms budget is preserved. |
| `autoload-SaveData.patch` | `OS.get_unique_id()` returns an empty string on Web, which gave every browser player the shared key `"dovefall-"`. Replaced with a per-install id. **On Android the native id is reused verbatim, so existing saves still decrypt.** |
| `export_presets.patch` | Excludes `store/*` — 144 KB of Play listing artwork that no player sees. |
| `project.patch` | Registers the `Net` autoload, last, after `SaveData`. |

Then set the API base in `autoload/Net.gd`:

```gdscript
const API_BASE := "https://dovefall-api.<subdomain>.workers.dev"
```

Leaving it `""` is a valid state: the game plays exactly as before, entirely
offline. That is the fallback if anything below goes wrong.

**Read `godot/patches/07-playfield-fairness.md` before you open the
leaderboard to anyone.** It is the one change I did not write for you, and it
is the difference between a fair board and one that quietly favours tall
phones.

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

## 7 · Publish the bundle to Pages

```bash
npx wrangler pages project create dovefall --production-branch main
npx wrangler pages deploy web/ --project-name dovefall
```

**You should see** a `https://dovefall.pages.dev` URL.

Now close the CORS loop — the Worker refuses browser origins it does not know:

```bash
# edit worker/wrangler.toml -> ALLOWED_ORIGINS
cd ../worker && npx wrangler deploy
```

**You should see** the game load at `dovefall.pages.dev`, play, and a score
appear in `curl -s $API/v1/board/normal` after a run.

If scores do not appear, open the browser console. A CORS error names the origin
it wanted; put that exact string in `ALLOWED_ORIGINS` and redeploy.

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
