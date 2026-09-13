// The heads-up display and the death panel.
//
// Everything here is DOM over the canvas, never drawn into it: the HUD must
// stay crisp at the device's own resolution while the playfield is scaled to
// fit, and text in a scaled canvas is the first thing to look cheap.
//
// The layout borrows from Flappy Link, which has proved the shape: a big score
// where your eye already is, the best score opposite it, a badge when you are
// on the board, and one line of context in the middle when something changes.

import type { CSSProperties } from 'react';
import { type Sim } from '../engine/sim.ts';
import { load } from '../store.ts';
import { t } from './kit.tsx';

export const pad5 = (n: number) => String(Math.max(0, n)).padStart(5, '0');

/** Whether the primary pointer is a finger. Used for wording only — the game
 *  itself takes a tap, a click and the space bar without caring which. */
export const touchFirst = (): boolean =>
  typeof matchMedia === 'function'
  && matchMedia('(pointer: coarse)').matches
  && matchMedia('(hover: none)').matches;

/**
 * Frost's sky is #C9E4EE, paper is #EEF4FF — 1.2:1 against WCAG's 3:1 floor
 * for bold text this size, measured, not eyeballed. Nineveh sits at 1.8:1.
 * The single-direction drop-shadow every other chapter's contrast already
 * covers for was never going to save those two: it only darkens one edge,
 * and a sky close to white in every direction needs a dark edge on all of
 * them. A hard pixel outline — four cardinal offsets plus the diagonals,
 * no blur, matching the game's own flat pixel-art shadows rather than a
 * soft glow — reads over every chapter this game has or will ever add,
 * which a per-chapter color fix would not.
 */
const pixelOutline = (px: number): CSSProperties => ({
  textShadow: [
    `${px}px 0 0 rgba(0,0,0,.85)`, `-${px}px 0 0 rgba(0,0,0,.85)`,
    `0 ${px}px 0 rgba(0,0,0,.85)`, `0 -${px}px 0 rgba(0,0,0,.85)`,
    `${px}px ${px}px 0 rgba(0,0,0,.7)`, `-${px}px -${px}px 0 rgba(0,0,0,.7)`,
    `${px}px -${px}px 0 rgba(0,0,0,.7)`, `-${px}px ${px}px 0 rgba(0,0,0,.7)`,
  ].join(', '),
});
const HUD_OUTLINE = pixelOutline(1);
const COUNTDOWN_OUTLINE = pixelOutline(2.5);

export function Hud({ sim, score, best, streak, top10, muted, onMute, onPause }: {
  sim: Sim | null;
  /** Pushed in from App rather than read off the sim: the sim mutates between
   *  renders, so a value React did not see change must not be printed. */
  score: number;
  best: number;
  streak: number;
  top10: boolean;
  muted: boolean;
  onMute: () => void;
  onPause: () => void;
}) {
  // The chapter banner is gone. It named the place you were flying through in
  // the middle of the only moment that needs your eyes, and the place is
  // already unmistakable — the whole sky changes colour. The chapters still
  // exist, and are still listed in Credits where there is time to read them.

  // Left-handed HUD: the score and mute move right, the pause button left, so
  // the controls sit under the thumb that is holding the phone.
  const lefty = load().settings.lefthand;

  const hazardNear = Boolean(
    sim && sim.phase === 'play'
    && sim.hz.some((z) => z.x > 1080 * 0.26 && z.x < 1080 * 0.95),
  );

  return (
    <div className="pointer-events-none absolute inset-0 select-none
                    pt-[max(0.6rem,env(safe-area-inset-top))]">
      <div className={`flex items-start justify-between px-3 ${lefty ? 'flex-row-reverse' : ''}`}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
            style={{ width: 44, height: 44 }}
            className="pointer-events-auto grid place-items-center rounded-lg border-2
                       border-paper/70 bg-black/25 text-[10px] font-bold tracking-wider text-paper/80"
          >
            {muted ? 'OFF' : 'SND'}
          </button>
          <span className="font-display text-3xl font-bold tabular-nums" style={HUD_OUTLINE}>
            {pad5(score)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-display text-3xl font-bold tabular-nums text-paper/75" style={HUD_OUTLINE}>
            {pad5(best)}
          </span>
          {top10 && (
            <span className="rounded-md bg-gold px-2 py-1 text-center font-display text-[10px]
                             font-bold leading-tight text-ink">TOP<br />10</span>
          )}
          <button
            type="button"
            onClick={onPause}
            aria-label="Pause"
            style={{ width: 44, height: 44 }}
            className="pointer-events-auto grid place-items-center rounded-lg bg-black/25 text-lg text-paper/80"
          >
            ⏸
          </button>
        </div>
      </div>

      {streak > 1 && sim?.phase === 'ready' && (
        <div className="mt-2 text-center font-display text-xs tracking-widest text-gold">
          🔥 {streak} {t('days')}
        </div>
      )}

      {sim?.phase === 'ready' && (
        <div className="absolute inset-x-0 bottom-[18%] text-center">
          <div className="font-display text-lg font-bold tracking-widest drop-shadow-[0_2px_0_rgba(0,0,0,.6)]">
            {touchFirst() ? t('tapflap') : t('clickflap')}
          </div>
          <div className="mt-1 text-xs text-paper/60">{touchFirst() ? '' : t('orspace')}</div>
        </div>
      )}

      {hazardNear && (
        <div className="absolute inset-x-0 bottom-[12%] flex justify-center px-6">
          <span className="rounded-md border-2 border-ink bg-gold px-3 py-2 text-center
                           font-display text-[11px] font-bold tracking-widest text-ink">
            {t('hazard')}
          </span>
        </div>
      )}
    </div>
  );
}

export function CountdownOverlay({ seconds }: { seconds: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="font-display text-7xl font-bold tabular-nums text-paper" style={COUNTDOWN_OUTLINE}>
        {Math.ceil(seconds)}
      </span>
    </div>
  );
}
