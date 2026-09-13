// The death panel. The most-seen screen in the game, so it carries exactly
// four things and no more: what you scored, whether it counted, one way to
// keep flying, and one way to tell someone.

import { useState } from 'react';
import { Button, t } from './kit.tsx';
import { pad5 } from './Hud.tsx';
import { shareScore } from './share.ts';
import { isKids, type Sim } from '../engine/sim.ts';
import type { Streak } from '../net/api.ts';

export function DeathPanel({ sim, best, isPb, streak, respawns, tutorial, armed, onRetry, onHome, onRespawn, onBuy, name, tag }: {
  sim: Sim;
  best: number;
  isPb: boolean;
  streak: Streak | null;
  respawns: number;
  tutorial: boolean;
  /** False for Config.RESTART_MS after the death — see App. */
  armed: boolean;
  onRetry: () => void;
  onHome: () => void;
  onRespawn: () => void;
  onBuy: () => void;
  name: string;
  tag: string;
}) {
  const [shared, setShared] = useState<string | null>(null);
  // In kids mode there is always another heart, because a child who runs out of
  // chances does not go and find a payment page — they put the phone down.
  const kids = isKids(sim.mode);
  const canRespawn = tutorial ? sim.tutRespawns > 0 : kids || respawns > 0;

  async function share() {
    const outcome = await shareScore({
      score: sim.score, name: name || 'A dove', tag, mode: sim.mode,
      skin: 'dove', isPb,
    });
    setShared(outcome === 'copied' ? 'Copied — go and paste it' : outcome === 'intent' ? 'Opening X…' : null);
  }

  return (
    <div
      className="absolute inset-0 flex items-end backdrop-blur-[2px]"
      style={{ background: 'var(--scrim)' }}
    >
      <div className="w-full px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6">
        <div className="mx-auto w-full max-w-md text-[#EEF4FF]">
          <div className="mb-1 text-center text-sm uppercase tracking-[0.2em] text-dim">
            {tutorial ? t('wellflown') : sim.deathCause === 'floor' ? t('down') : t('clipped')}
          </div>
          <div className="text-center font-display text-6xl font-bold tabular-nums">
            {pad5(sim.score)}
          </div>
          <div className="mb-5 mt-1 text-center text-sm text-dim">
            {isPb ? <span className="text-gold">{t('newbest')}</span> : <>{t('best')} {pad5(best)}</>}
            {streak && streak.current > 0 && (
              <> · 🔥 {streak.current} {t('days')}{streak.outcome === 'saved' ? ` · ${t('streaksaved')}` : ''}</>
            )}
            {sim.respawnUsed && !kids && <> · <span className="text-dim/70">{t('unranked')}</span></>}
          </div>

          <div className="flex flex-col gap-2.5">
            {canRespawn && (
              <button
                type="button"
                onClick={onRespawn}
                disabled={!armed}
                style={{ minHeight: 56 }}
                className="w-full animate-pulse rounded-2xl bg-gold px-6 text-base font-semibold
                           text-ink disabled:opacity-60"
              >
                ♥ {tutorial || kids ? t('keepflying') : `${t('keepflying')} · ${respawns}`}
              </button>
            )}
            {!canRespawn && !tutorial && (
              <Button onClick={onBuy} disabled={!armed}>♥ {t('keepgoing')}</Button>
            )}

            <Button primary onClick={onRetry} disabled={!armed}>{t('flyagain')}</Button>

            <div className="flex gap-2.5">
              <Button onClick={share} disabled={!armed}>{t('sharebest')}</Button>
              <Button onClick={onHome} disabled={!armed}>{t('back')}</Button>
            </div>
            {shared && <div className="text-center text-xs text-dim">{shared}</div>}
          </div>

          {tutorial && !kids && (
            <p className="mt-4 text-center text-xs leading-relaxed text-dim">
              That heart puts you back where you fell. The first one is on us.
              After that they cost a little, and a run you continue stays off
              the leaderboard — so nobody can buy their way up it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
