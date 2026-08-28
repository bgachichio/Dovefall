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

## How to know it worked

1. `checksum : 4075699207` still prints. (It is untouched by this change; if it
   moved, something else did.)
2. Print the first three gate `top` values for seed `0xD0FE` in `normal`.
   **They must be identical on the Pixel, on the desktop, and in a browser
   window you resize while the game is running.** Before this change they were
   not.
3. Open the web build on a laptop. The game is a portrait column with sky-
   coloured bars either side, and it plays. Before this change it did not.

## The trade, stated plainly

Bars. On a 20:9 phone the playfield no longer bleeds to the top and bottom
edges. The alternative — a fixed gameplay box with a full-bleed backdrop drawn
behind it — is the forty-site refactor this file used to specify, and it
remains available if the bars ever bother you more than the risk does. The
server records `playfield_h` on every run either way, so the effect of any
future change is measurable rather than assumed.
