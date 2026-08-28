# 07 — The playfield must not depend on the window

**Status: specified, not patched.** This is the one change I would not write
blind, because it moves the ground and I cannot run Godot to see where it lands.
Everything else in this directory is a ready-to-apply diff; this is a precise
spec to apply with the editor open. Budget an hour, most of it looking at the
Pixel.

---

## The defect

`project.godot` sets `stretch/aspect="expand"`. On a display taller than 16:9
the viewport grows: `1080×1920` on the design target becomes `1080×2400` on the
Pixel 9 Pro. Width is stable; **height is not**.

`Game.gd` generates the course from `_vh`:

```gdscript
var lo0 := _vh * 0.09
var hi0 := _vh * 0.74 - g
```

but the gap itself is an absolute pixel value, derived from width:

```gdscript
func _cur_gap() -> float:
    return _dove_h() * m["gap"] * float(Config.band_for(score)["gap_x"]) * (1.0 + assist)
# _dove_h() = Config.DOVE_H * maxf(2.0, roundf(_vw / Config.DOVE_DIVISOR))
```

So the gap is constant while the band it is placed in grows with screen height:

| Device | Viewport | Placement band | Freedom |
|---|---|---|---|
| 16:9 design target | 1080×1920 | 172 → 580 | **408 px** |
| Pixel 9 Pro (20:9) | 1080×2400 | 216 → 936 | **720 px** |

**The same seed produces a materially different course on a taller phone, and a
76% wider placement range is an easier one.** The height-delta clamp
(`md = _vh * r["delta"]`), the drift amplitude, and every hazard dimension scale
the same way.

## Why the existing gate does not catch it

Runbook Gate 9 requires `checksum : 4075699207` to match between desktop and
device. It will match — and it proves nothing about this. `_determinism_check()`
exercises the RNG stream and the vertical integration only; it never touches
`_vw` or `_vh`. The gate passes while the courses differ.

That is worth internalising: **the determinism check validates physics, not
geometry.** Add a second gate that prints the first three gate `top` values for
a fixed seed and compare *those* across devices.

## Why it matters now and not before

Alone on a phone, a slightly easier course is invisible. On a shared
leaderboard it is a structural unfairness: tall-phone players out-rank
short-phone players for reasons neither can see. And it makes replay validation
impossible in principle — the server would have to take the client's word for
the viewport, which is exactly the thing a cheater would lie about.

## The fix

Pin gameplay geometry to a fixed logical box, centred in whatever viewport the
device provides. Extra screen height becomes more sky and more ground — visible,
but not playable, space.

Add to `Game.gd`:

```gdscript
## Gameplay geometry is measured against a FIXED logical playfield, never the
## window. With stretch/aspect="expand" the viewport grows on taller phones and
## every _vh below would otherwise hand a 20:9 device a different — and easier —
## course than a 16:9 one from the same seed.
func _play_h() -> float:
    return minf(_vh, float(Config.BASE_H))   # 1920

func _play_top() -> float:
    return (_vh - _play_h()) * 0.5
```

Then replace `_vh` with `_play_top() + _play_h()` arithmetic at the **gameplay**
sites below. Line numbers are against the unpatched `scripts/Game.gd`.

| Line | Site | Becomes |
|---|---|---|
| 91 | `_reset()` start height | `_play_top() + _play_h() * 0.42` |
| 137–138 | `_spawn()` `lo0` / `hi0` | `_play_top() + _play_h() * 0.09` / `* 0.74 - g` |
| 149 | height-delta clamp `md` | `_play_h() * float(r["delta"])` |
| 155 | gate drift amplitude | `_play_h() * Rng.range_f(0.022, 0.048)` |
| 170 | low-gate hazard guard | `_play_top() + _play_h() * 0.62` |
| 174, 177–178 | hazard height, `y`, `y0` | `_play_h() * …`, offset by `_play_top()` where absolute |
| 196 | air hazard `y` | `_play_top() + _play_h() * 0.2` |
| 266 | Second Wind respawn height | `_play_top() + _play_h() * 0.42` |
| 288 | READY bob | `_play_top() + _play_h() * 0.42 + sin(…) * (_play_h() * 0.012)` |
| 297–298 | DEAD floor | `_play_top() + _play_h() * 0.86` |
| 328 | gate drift clamp | `_play_top() + _play_h() * 0.07`, `* 0.76 - gap` |
| 363 | lower gate collision rect | height `_play_top() + _play_h() - top - gap` |
| 387 | ground hazard rect | `_play_top() + _play_h() * GROUND - z["h"]` |
| 394 | floor death test | `_play_top() + _play_h() * 0.88` |

**Leave every site from line 495 onward alone** — those are `_draw()` and its
helpers, and they should keep filling the real viewport. The two exceptions,
which must move with the gameplay ground or the bird will die in mid-air above a
drawn floor:

- line 505 — `draw_rect(… _vh * GROUND …)` the ground band
- line 514 — `_draw_spike(… _vh * GROUND …)` ground hazards
- line 562 — `Art.blit_flat(… _vh * GROUND …)` landmarks

Line 229 (the Second Wind tap zone) and 446/449 (particles) are UI and cosmetic
respectively. Both should keep using `_vh`.

## How to know it worked

1. `checksum : 4075699207` still prints. If it changed, something in `Config` or
   `Rng` moved and this patch is not the cause — stop and find out what is.
2. New gate: print the first three gate `top` values for seed `0xD0FE` in
   `normal`. Run on the Pixel and on the desktop at 16:9. **The three numbers
   must be identical.** Before this patch they are not.
3. Play a run on the Pixel. The ground sits where it is drawn; the bird dies
   when it touches it, not above or below it.

## Until it is applied

The server already records `playfield_h` on every submitted run, so a board
built before this patch can be **segmented rather than discarded**. That was the
point of storing it. Check the spread with:

```sql
SELECT playfield_h, COUNT(*), AVG(score), MAX(score)
  FROM bests GROUP BY playfield_h ORDER BY playfield_h;
```

If average score rises with `playfield_h`, this defect is visible in your live
data and the fix is overdue.
