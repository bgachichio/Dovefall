# Parity — the web build against the Godot build

The question this file answers: **did the rewrite change how Dovefall plays?**

Not "does it still work" — whether a player who knew the Android build would
notice anything different in their thumbs. Every row below was checked against
`scripts/Game.gd`, `autoload/Config.gd`, `autoload/Sfx.gd` and `project.godot`
in the Godot project, not from memory.

Five things had drifted. All five are fixed and each now has a test whose only
job is to keep it fixed.

---

## 1 · The simulation — unchanged, and mechanically so

The numbers are not retyped. `tools/port-constants.mjs` transforms the GDScript
constant blocks into TypeScript, so `MODES`, `BANDS`, `RAMP`, `CHAPTERS`,
`SKINS` and every pixel map are the same literals the Android build was tuned
with. A one-digit transcription error is not possible here because there is no
transcription.

| Behaviour | Godot | Web | |
|---|---|---|---|
| Timestep | `_physics_process`, 120 Hz fixed, `physics_jitter_fix = 0` | `FIXED` accumulator, 120 Hz | same |
| Gravity, flap, terminal | `MODES[mode]`, `TERMINAL_MULT` | ported literals | same |
| Gap | `dove_h × mode.gap × band.gap_x × (1 + assist)` | identical expression | same |
| Speed | `mode.spd × band.spd_x` | identical | same |
| Gate width | `max(24, vw × 0.125)` | identical | same |
| Dove size | `max(2, round(vw / 51))`, 16 × 10 sprite units | identical | same |
| Placement band | `lo = vh×0.09`, `hi = vh×0.74 − gap`, amp from `RAMP` | identical | same |
| Height-delta clamp | `clamp(top, last ± vh×delta)` then re-clamped to the band | identical | same |
| Hazard choice, density, the never-under-a-low-gate rule | `RAMP.dens`, `top + gap > vh×0.62` | identical | same |
| Drift | `clamp(base + sin(t×1.15 + ph) × drift, vh×0.07, vh×0.76 − gap)` | identical | same |
| Air hazard motion | `x −= spd·dt·(1 + vx)`, `y = y0 + sin(t×1.6 + ph)×amp` | identical | same |
| Hitbox | `mode.hit × dove`, anchored at `vw × 0.26` | identical | same |
| Coyote time | grace accumulates, death at `> mode.coy` | identical | same |
| Floor / ceiling | die below `vh − vh×0.12`; clamp at 0 with `vy = 0` | identical | same |
| Death fall | `vy += grav·dt×1.4`, rot to 1.6, rest at `vh − vh×0.14` | identical | same |
| Continue | clear to `vw×0.26 + dove_w × 2.6`, invuln, countdown | identical | same |
| RNG | xorshift32 from `Rng.gd` | same stream, checksum **4075699207** asserted | same |
| Daily seed | `y×10000 + m×100 + d`, UTC | identical | same |

`test/engine.test.mjs` asserts the checksum, the derived sizes, the placement
band, and that four different seeds place every gate inside the legal band.

---

## 2 · Five things that had drifted, and are fixed

### 2.1 The flap was silent — the worst of the five

`Game.gd` fires the flap sound and the buzz **in `_queue_flap()`**, on the input
event, with a comment saying why: deferring it to the tick costs up to 8 ms of
latency for nothing.

The port routed it through a per-tick event list — which `step()` clears at the
top. The sound was thrown away before anything could play it. In a game whose
entire input is one tap, that is the feel.

Fixed: `queueFlap()` returns whether it took a flap, and the caller fires the
feedback immediately, exactly where Godot did.

### 2.2 Catch-up allowed 30 ticks where Godot allowed 12

`project.godot` sets `physics/common/max_physics_steps_per_frame = 12` — the
spiral-of-death guard. The port clamped at a quarter second, which is 30 ticks.
Coming back from a locked screen, the web build would have run two and a half
times more world than the Android build before drawing a frame.

Fixed: `MAX_STEPS_PER_FRAME = 12`, and the catch-up window derives from it.

### 2.3 The world moved during the respawn countdown

Godot paused the scene tree for `SW_COUNTDOWN_S`, so `t` stopped — and `t`
drives gate drift. The port advanced `t` before the countdown check, so gates
drifted while the player watched a number count down: the one moment they are
promised nothing changes.

Fixed: the countdown returns before `t` advances.

### 2.4 A death could be restarted by the tap that caused it

`Config.RESTART_MS` (320 ms) exists so the tap still in the air when you die
does not skip the score you have not finished reading. The port had no guard.

Fixed: `canRestart()`, and the death panel's buttons are inert for 320 ms.

### 2.5 The second wind was never offered

`session_deaths` lived on Godot's `Game` node, which outlives a run, so the
offer appeared from your second death of a sitting. A fresh `Sim` per run reset
it to zero, and `SW_MIN_SESSION_DEATHS` could then never be met.

Fixed: the count is carried across runs and passed into `createSim`.

---

## 3 · Strictly better on the web

| | Why |
|---|---|
| **Touch targets are real** | The menus are DOM. 48 CSS px is 48 CSS px on every phone. In the canvas build a design unit was worth 0.288 CSS px on an iPhone SE, and every control had to be sized against the worst case |
| **Load** | 110 KB over the wire against roughly 6 MB. On a Kenyan mobile connection that is the difference between playing and leaving |
| **Time to first tap** | No WASM to fetch, compile and instantiate |
| **Sound has no latency floor** | Oscillators start on the input event; there is no sample bank to decode first |
| **The letterbox costs nothing** | The canvas is sized to the fitted playfield, so the bars are a parent background rather than pixels filled every frame |
| **Text is crisp** | The HUD is DOM at device resolution, not text drawn into a scaled canvas |
| **It is testable** | 22 engine tests and 7 browser tests, including six device sizes flying one seed. The Godot build had a checksum and a runbook |

---

## 4 · Genuinely different, and stated rather than hidden

| | Status |
|---|---|
| **No music** | `Music.play_for(kind)` played a track per chapter. The web build has sound effects only. This is a real absence, not a rounding error — the chapter change is now marked by a chime and the sky, not a new track. Adding it means shipping audio files, which is the first thing that would put weight back on the download |
| **Particle motion** | The seeded stream is untouched (asserted), but the drift integration is written fresh rather than transcribed. Snow and bubbles move slightly differently. Cosmetic, and invisible without the two builds side by side |
| **No landscape layout** | Same as Godot: the world is portrait. On a wide screen it is a centred column with sky either side |
| **Google sign-in** | Endpoints built and tested; no button. Same state as the Android build |
| **Replay validation** | The flap log is captured and stored, and nothing validates it yet. Same as the Android build |

---

## 5 · How to re-check this

```bash
cd game && npm test                       # 22 engine tests
npm run build && node --test --test-timeout=120000 "test/play.test.mjs"
```

The parity tests are the last block of `test/engine.test.mjs`. Each one names
the line of GDScript it is holding the port to. If you change the engine and
one of them goes red, the game just stopped playing the way it played.
