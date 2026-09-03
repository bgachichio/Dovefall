// The death panel. The most-seen screen in the game, so it carries exactly
// four things and no more: what you scored, whether it counted, one way to
// keep flying, and one way to tell someone.

import { useState } from 'react';
import { Button, t } from './kit.tsx';
import { pad5 } from './Hud.tsx';
import { shareScore } from './share.ts';
import type { Sim } from '../engine/sim.ts';

export function DeathPanel({ sim, best, isPb, streak, respawns, tutorial, onRetry, onHome, onRespawn, onBuy, name, tag }: {
  sim: Sim;
  best: number;
  isPb: boolean;
  streak: { current: number; alive: boolean; outcome?: string } | null;
  respawns: number;
  tutorial: boolean;
  onRetry: () => void;
  onHome: () => void;
  onRespawn: () => void;
  onBuy: () => void;
  name: string;
  tag: string;
}) {
  const [shared, setShared] = useState<string | null>(null);
  const canRespawn = tutorial ? sim.tutRespawns > 0 : respawns > 0;

  async function share() {
    const outcome = await shareScore({
      score: sim.score, name: name || 'A dove', tag, mode: sim.mode,
      skin: 'dove',
    });
    setShared(outcome === 'copied' ? 'Link copied' : outcome === 'intent' ? 'Opening X…' : null);
  }

  return (
    <div className="absolute inset-0 flex items-end bg-ink/72 backdrop-blur-[2px]">
      <div className="w-full px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-1 text-center text-sm uppercase tracking-[0.2em] text-dim">
            {tutorial ? t('wellflown') : sim.deathCause === 'floor' ? 'Down' : 'Clipped'}
          </div>
          <div className="text-center font-display text-6xl font-bold tabular-nums">
            {pad5(sim.score)}
          </div>
          <div className="mb-5 mt-1 text-center text-sm text-dim">
            {isPb ? <span className="text-gold">New best</span> : <>{t('best')} {pad5(best)}</>}
            {streak && streak.current > 0 && (
              <> · 🔥 {streak.current} {t('days')}{streak.outcome === 'saved' ? ` · ${t('streaksaved')}` : ''}</>
            )}
            {sim.respawnUsed && <> · <span className="text-dim/70">unranked</span></>}
          </div>

          <div className="flex flex-col gap-2.5">
            {canRespawn && (
              <button
                type="button"
                onClick={onRespawn}
                style={{ minHeight: 56 }}
                className="w-full animate-pulse rounded-2xl bg-gold px-6 text-base font-semibold text-ink"
              >
                ♥ {tutorial ? 'Keep flying — free' : `${t('respawns')} · ${respawns}`}
              </button>
            )}
            {!canRespawn && !tutorial && (
              <Button onClick={onBuy}>♥ {t('getrespawns')}</Button>
            )}

            <Button primary onClick={onRetry}>Fly again</Button>

            <div className="flex gap-2.5">
              <Button onClick={share}>{t('sharebest')}</Button>
              <Button onClick={onHome}>{t('back')}</Button>
            </div>
            {shared && <div className="text-center text-xs text-dim">{shared}</div>}
          </div>

          {tutorial && (
            <p className="mt-4 text-center text-xs leading-relaxed text-dim">
              That heart is a respawn. Your first one is free — after that they
              cost a little, and a continued run never enters the leaderboard.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
