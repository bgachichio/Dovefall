# 07 — Screen independence  ·  RESOLVED

**Status: fixed in `project.patch`.** This file previously specified a
forty-site refactor. It is kept as the record of what was wrong and why the
one-line fix is the right one, because the failure it describes is the kind
that comes back.

---

## What was wrong

`project.godot` had `window/stretch/aspect="expand"`. Under "expand" the
viewport grows to match the window, so `_vw` and `_vh` differ on every device —
and `Game.gd` derives the entire course from them, while the gap width is an
absolute pixel value derived from `_vw`.

Measured across the device classes:

| Device | Viewport | Dove | Gap | Placement band | |
|---|---|---|---|---|---|
| Phone 16:9 | 1080 x 1920 | 336 px | 840 px | **408 px** | the design target |
| Pixel 9 Pro 20:9 | 1080 x 2400 | 336 px | 840 px | **720 px** | 76% easier |
| iPad portrait 4:3 | 1440 x 1920 | 448 px | 1120 px | **128 px** | far harder |
| Laptop 16:9 | 3413 x 1920 | 1072 px | 2680 px | **-1432 px** | **broken** |
| Desktop 16:10 | 3072 x 1920 | 960 px | 2400 px | **-1152 px** | **broken** |

A negative band means `hi0 < lo0`, which the code clamps — so every gate spawns
at exactly the same height, behind a dove a thousand pixels wide. The game was
not merely unfair in landscape; it did not work.

## Why the determinism gate never caught it

Runbook Gate 9 requires `checksum : 4075699207` to match between desktop and
device, and it does. `_determinism_check()` exercises the RNG stream and the
vertical integration and **never touches `_vw` or `_vh`**. The gate validates
physics, not geometry. Worth remembering: a green check is only as wide as what
it measures.

## The fix

```ini
window/stretch/aspect="keep"     ; was "expand"
```

"keep" pins the viewport at exactly 1080x1920 on every screen and letterboxes
the remainder. Every calculation in `Game.gd` was already correct for that
viewport, so nothing else had to move — and every device now flies the
identical course from a seed, which is also what makes the leaderboard fair.

`Game.gd._sync_clear_colour()` paints the letterbox with the current chapter's
sky, so the bars read as part of the world rather than as a frame around it,
and they follow the palette through the chapter cross-fades.

## What it measures now

`node godot/tools/screen-report.mjs`, and re-measured in a real Chromium by
`site/test/shell.test.mjs`:

| Device | CSS viewport | Scale | Letterbox | Framebuffer |
|---|---|---|---|---|
| Pixel 9 Pro, Chrome | 448 × 936 | 0.415 | 70 px top and bottom | 1280 × 2674 |
| iPhone 16, Safari | 393 × 745 | 0.364 | 23 px top and bottom | 1179 × 2235 |
| iPhone 16, installed | 393 × 852 | 0.364 | 77 px top and bottom | 1179 × 2556 |
| Galaxy S24 | 360 × 700 | 0.333 | 30 px top and bottom | 1080 × 2100 |
| iPhone SE, Safari | 375 × 553 | 0.288 | 32 px either side | 750 × 1106 |

The scales differ by a factor of 1.4. The four numbers that decide difficulty —
1080 × 1920 viewport, 336 × 210 dove, 840 px gap, 408 px placement band — are
byte-identical on every row, because they are computed from the viewport and
the viewport is a constant. That is the whole claim, and it is why a big phone
confers no advantage on the leaderboard.

Two second-order effects do vary, and neither touches difficulty:

- **Sharpness.** The framebuffer is the phone's native pixels, so a Pixel 9 Pro
  renders the 1080-wide design at 1.18× and an iPhone SE at 0.58×. The SE
  picture is genuinely softer. There are not enough pixels on that screen for
  it to be otherwise.
- **Touch targets.** A design unit is worth 0.415 CSS px on a Pixel and 0.288
  on an SE, so `UiKit.ROW` has to clear the 48 CSS px floor at 0.288 — hence
  168 units, not 140.

## How to know it worked

1. `checksum : 4075699207` still prints. (It is untouched by this change; if it
   moved, something else did.)
2. Print the first three gate `top` values for seed `0xD0FE` in `normal`.
   **They must be identical on the Pixel, on the desktop, and in a browser
   window you resize while the game is running.** Before this change they were
   not.
3. Open the web build on a laptop with `?device=any`. The game is a portrait
   column with sky-coloured bars either side, and it plays. Before this change
   it did not. (Without the override a laptop is shown a link instead —
   Dovefall is a phone game — but the rendering path is the same one a tablet
   in landscape takes, so it is still worth looking at.)

## The trade, stated plainly

Bars. On a 20:9 phone the playfield no longer bleeds to the top and bottom
edges. The alternative — a fixed gameplay box with a full-bleed backdrop drawn
behind it — is the forty-site refactor this file used to specify, and it
remains available if the bars ever bother you more than the risk does. The
server records `playfield_h` on every run either way, so the effect of any
future change is measurable rather than assumed.
