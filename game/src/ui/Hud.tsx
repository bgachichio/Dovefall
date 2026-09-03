// The heads-up display and the death panel.
//
// Everything here is DOM over the canvas, never drawn into it: the HUD must
// stay crisp at the device's own resolution while the playfield is scaled to
// fit, and text in a scaled canvas is the first thing to look cheap.
//
// The layout borrows from Flappy Link, which has proved the shape: a big score
// where your eye already is, the best score opposite it, a badge when you are
// on the board, and one line of context in the middle when something changes.

import { useEffect, useState } from 'react';
import { CHAPTERS } from '../engine/constants.ts';
import { chapterIndex, type Sim } from '../engine/sim.ts';
import { t } from './kit.tsx';

export const pad5 = (n: number) => String(Math.max(0, n)).padStart(5, '0');

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
  const chapter = CHAPTERS[chapterIndex(score)];
  const [banner, setBanner] = useState<string | null>(null);

  // One line of context when the chapter turns, then it gets out of the way.
  useEffect(() => {
    if (!sim || sim.phase !== 'play') return;
    setBanner(`${chapter.name} · ${chapter.ref}`);
    const id = setTimeout(() => setBanner(null), 2600);
    return () => clearTimeout(id);
  }, [chapter.name, chapter.ref, sim, sim?.palTo]);

  const hazardNear = Boolean(
    sim && sim.phase === 'play'
    && sim.hz.some((z) => z.x > 1080 * 0.26 && z.x < 1080 * 0.95),
  );

  return (
    <div className="pointer-events-none absolute inset-0 select-none
                    pt-[max(0.6rem,env(safe-area-inset-top))]">
      <div className="flex items-start justify-between px-3">
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
          <span className="font-display text-3xl font-bold tabular-nums drop-shadow-[0_2px_0_rgba(0,0,0,.6)]">
            {pad5(score)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-display text-3xl font-bold tabular-nums text-paper/75
                           drop-shadow-[0_2px_0_rgba(0,0,0,.6)]">
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

      {banner && (
        <div className="mt-3 flex justify-center">
          <span className="rounded-md border-2 border-ink bg-paper px-3 py-1.5
                           font-display text-[11px] font-bold tracking-widest text-ink">
            {banner}
          </span>
        </div>
      )}

      {sim?.phase === 'ready' && (
        <div className="absolute inset-x-0 bottom-[18%] text-center">
          <div className="font-display text-lg font-bold tracking-widest drop-shadow-[0_2px_0_rgba(0,0,0,.6)]">
            TAP TO FLAP
          </div>
          <div className="mt-1 text-xs text-paper/60">or press space</div>
        </div>
      )}

      {hazardNear && (
        <div className="absolute inset-x-0 bottom-[12%] flex justify-center px-6">
          <span className="rounded-md border-2 border-ink bg-gold px-3 py-2 text-center
                           font-display text-[11px] font-bold tracking-widest text-ink">
            HAZARD AHEAD · CHANGE ALTITUDE
          </span>
        </div>
      )}
    </div>
  );
}

export function CountdownOverlay({ seconds }: { seconds: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="font-display text-7xl font-bold text-paper drop-shadow-[0_4px_0_rgba(0,0,0,.5)]">
        {Math.ceil(seconds)}
      </span>
    </div>
  );
}
