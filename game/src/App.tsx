// The state machine and the seam between the 120 Hz loop and React.
//
// The sim lives in a ref and is mutated by the loop; React never owns it and
// never waits on it. What React does own is which screen is up and the handful
// of numbers the HUD prints, and those are pushed in at most once a frame from
// values that have actually changed.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canRestart, continueRun, createSim, replayBlob, secondWind, VH,
  type ModeId, type Sim,
} from './engine/sim.ts';
import { dailySeed, randomSeed, seedCode, todayKey } from './engine/rng.ts';
import { attachInput, startLoop, type LoopHandle } from './engine/loop.ts';
import { VERSION } from './engine/constants.ts';
import * as api from './net/api.ts';
import { bestFor, load, recordRun, save, setSetting } from './store.ts';
import { Hud, CountdownOverlay } from './ui/Hud.tsx';
import { DeathPanel } from './ui/Death.tsx';
import { Account, Credits, Leaderboard, NameScreen, Pause, Respawns, Settings, Title, Wardrobe } from './ui/Screens.tsx';
import { buzz, gatePitch, play as playSound, setMuted } from './audio.ts';

type Route = 'title' | 'name' | 'run' | 'board' | 'settings' | 'credits' | 'wardrobe' | 'account' | 'respawns';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Sim | null>(null);
  const loopRef = useRef<LoopHandle | null>(null);
  const pausedRef = useRef(false);

  const stored = load();
  const [route, setRoute] = useState<Route>(stored.tutorialDone ? 'title' : 'name');
  const [phase, setPhase] = useState<'ready' | 'play' | 'dead'>('ready');
  const [score, setScore] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMutedState] = useState(!stored.settings.sfx);
  const [respawns, setRespawns] = useState(stored.respawns);
  const [streaks, setStreaks] = useState({ play: stored.playStreak, daily: stored.dailyStreak });
  const [isPb, setIsPb] = useState(false);
  const [lastStreak, setLastStreak] = useState<{ current: number; alive: boolean; outcome?: string } | null>(null);
  const [top10, setTop10] = useState(false);
  // Config.RESTART_MS. For a third of a second after a death nothing on the
  // panel responds: the tap that killed you is still in the air, and nobody
  // wants to lose the score they have not finished reading.
  const [armed, setArmed] = useState(false);

  const mode = stored.settings.mode as ModeId;
  const best = bestFor(mode);
  // Read inside the loop's callbacks, which are created once.
  const bestRef = useRef(best);
  bestRef.current = best;
  /** Deaths this sitting, carried across runs — see SimOptions.sessionDeaths. */
  const sessionDeathsRef = useRef(0);

  // A handle on the live sim, for automated play. Localhost only — the same
  // rule as the API override, and for the same reason: on a real host this
  // would hand a cheat a steering wheel, and the server's plausibility bounds
  // are a floor, not a fence.
  useEffect(() => {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
    (window as unknown as { __dovefall?: unknown }).__dovefall = {
      sim: () => simRef.current,
      route: () => route,
    };
  }, [route]);

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--font-scale', String([0.9, 1, 1.15, 1.3][load().settings.fontScale] ?? 1),
    );
  }, [route]);

  useEffect(() => {
    if (!api.online()) return;
    const s = load();
    const first = s.token ? api.me() : api.signInGuest();
    first
      .then((m) => {
        setRespawns(m.respawns ?? 0);
        if (m.streaks) {
          setStreaks({ play: m.streaks.play.current, daily: m.streaks.daily.current });
          save({ playStreak: m.streaks.play.current, dailyStreak: m.streaks.daily.current });
        }
      })
      .catch(() => { /* offline is a supported state, not an error */ });
  }, []);

  // ------------------------------------------------------------- the loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    const stage = stageRef.current;
    if (!canvas || !frame || !stage) return;
    const handle = startLoop({
      canvas,
      frame,
      stage,
      getSim: () => simRef.current,
      getSkin: () => load().settings.skin,
      paused: () => pausedRef.current,
      onEvents: (events, s) => {
        for (const e of events) {
          if (e === 'gate') {
            playSound('gate', gatePitch(s.score));
            buzz(8);
            // Game.gd rings the personal-best chime the moment you pass it,
            // not on the death panel. That is the moment it means something.
            if (s.score === bestRef.current + 1 && bestRef.current > 0) playSound('pb');
          } else if (e === 'death') {
            playSound('death');
            buzz(20);
          } else if (e === 'continue') {
            playSound('pb');
          } else {
            playSound(e);
          }
        }
      },
      onFrame: (s) => {
        setPhase((p) => (p === s.phase ? p : s.phase));
        setScore((n) => (n === s.score ? n : s.score));
        setCountdown((c) => (Math.abs(c - s.countdown) < 0.05 ? c : s.countdown));
      },
    });
    loopRef.current = handle;
    const ro = new ResizeObserver(() => handle.resize());
    ro.observe(frame);
    window.addEventListener('resize', handle.resize);
    // The flap's sound and buzz fire HERE, on the input event, exactly as
    // Game.gd did — deferring them to the tick adds up to 8 ms of latency for
    // nothing, and in a one-touch game that is the whole feel.
    const detach = attachInput(
      canvas,
      () => (pausedRef.current ? null : simRef.current),
      () => { playSound('flap'); buzz(12); },
    );
    return () => {
      detach();
      ro.disconnect();
      window.removeEventListener('resize', handle.resize);
      handle.stop();
    };
  }, []);

  // A run must never continue while the phone is in someone's pocket.
  useEffect(() => {
    const hide = () => { if (document.hidden) doPause(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', hide);
    };
  });

  useEffect(() => {
    if (phase !== 'dead') { setArmed(false); return; }
    const s = simRef.current;
    if (!s) return;
    const wait = Math.max(0, 320 - (performance.now() - s.diedAt));
    if (canRestart(s, performance.now())) { setArmed(true); return; }
    const id = setTimeout(() => setArmed(true), wait);
    return () => clearTimeout(id);
  }, [phase]);

  const doPause = useCallback(() => {
    if (simRef.current?.phase !== 'play') return;
    pausedRef.current = true;
    setPaused(true);
  }, []);

  // --------------------------------------------------------------- runs
  const startRun = useCallback((opts: { daily?: boolean; tutorial?: boolean } = {}) => {
    const s = load();
    const seed = opts.daily ? dailySeed(todayKey()) : randomSeed();
    simRef.current = createSim({
      mode: s.settings.mode as ModeId,
      seed,
      daily: opts.daily,
      tutorial: opts.tutorial,
      atmos: s.settings.atmos,
      sessionDeaths: sessionDeathsRef.current,
    });
    setIsPb(false);
    setLastStreak(null);
    setPhase('ready');
    setScore(0);
    pausedRef.current = false;
    setPaused(false);
    setRoute('run');
  }, []);

  // Submit on death. Fire and forget: the local best is already written.
  const submitted = useRef(0);
  useEffect(() => {
    const s = simRef.current;
    if (!s || phase !== 'dead' || submitted.current === s.diedAt) return;
    submitted.current = s.diedAt;

    sessionDeathsRef.current = s.sessionDeaths;
    const pb = recordRun(s.mode, s.score, s.feathers);
    setIsPb(pb);
    if (s.tutorial) { save({ tutorialDone: true }); return; }

    api.submitRun({
      mode: s.mode,
      score: s.score,
      duration_ms: Math.max(1, Math.round(s.tick * (1000 / 120))),
      seed: seedCode(s.seed),
      is_daily: s.daily,
      flap_ticks: replayBlob(s),
      playfield_h: VH,
      second_wind_used: s.swUsed,
      respawn_used: s.respawnUsed,
      assist_active: s.assist > 0,
      build: `web-${VERSION}`,
    }).then((r) => {
      if (r.streaks) {
        setStreaks({ play: r.streaks.play.current, daily: r.streaks.daily.current });
        save({ playStreak: r.streaks.play.current, dailyStreak: r.streaks.daily.current });
        setLastStreak({ ...r.streaks.play, outcome: r.streaks.outcome });
      }
      if (r.personal_best) setTop10(true);
    }).catch(() => { /* the score is safe on this phone */ });
  }, [phase]);

  // Where Back goes. A screen can be reached from the title, from settings, or
  // from a death panel mid-run, and it has to return to whichever it was.
  const fromRef = useRef<Route>('title');
  const go = useCallback((to: string) => {
    setRoute((cur) => { fromRef.current = cur; return to as Route; });
  }, []);
  const back = useCallback(() => setRoute(fromRef.current), []);
  const backToTitle = () => { simRef.current = null; setRoute('title'); };

  const onRespawn = useCallback(() => {
    const s = simRef.current;
    if (!s) return;
    if (s.tutorial) { s.tutRespawns -= 1; continueRun(s); return; }
    if (respawns <= 0) { go('respawns'); return; }
    setRespawns((n) => n - 1);
    api.spendRespawn().then((r) => setRespawns(r.respawns)).catch(() => { /* offline: allow it */ });
    if (s.swOffer) secondWind(s); else continueRun(s);
  }, [respawns, go]);


  // ---------------------------------------------------------------- view
  const sim = simRef.current;
  const showGame = route === 'run';

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink">
      {/* The frame is the whole visible area and paints the surround in the
          chapter's sky; the stage is exactly the fitted playfield. The HUD
          lives inside the stage so it stays with the game on a wide screen
          rather than spreading to the window edges. */}
      <div
        ref={frameRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ visibility: showGame ? 'visible' : 'hidden' }}
      >
        <div ref={stageRef} className="relative">
          <canvas ref={canvasRef} />
          {sim && (
            <Hud
              sim={sim}
              score={score}
              best={best}
              streak={streaks.play}
              top10={top10}
              muted={muted}
              onMute={() => { const m = !muted; setMutedState(m); setMuted(m); setSetting('sfx', !m); }}
              onPause={doPause}
            />
          )}
          {countdown > 0 && <CountdownOverlay seconds={countdown} />}
        </div>

        {/* These dim the whole frame, letterbox included — a bright bar above
            a death panel reads as a bug. Their content is max-width-centred,
            so they look the same on a phone and on a laptop. */}
        {sim && phase === 'dead' && !paused && (
          <DeathPanel
            sim={sim}
            best={best}
            isPb={isPb}
            streak={lastStreak}
            respawns={respawns}
            tutorial={sim.tutorial}
            armed={armed}
            name={stored.name}
            tag={stored.tag}
            onRetry={() => startRun({ daily: sim.daily })}
            onHome={backToTitle}
            onRespawn={onRespawn}
            onBuy={() => go('respawns')}
          />
        )}
        {paused && (
          <Pause
            onResume={() => { pausedRef.current = false; setPaused(false); }}
            onQuit={backToTitle}
            go={go}
          />
        )}
      </div>
      {route === 'name' && (
        <NameScreen onDone={() => { save({ tutorialDone: false }); startRun({ tutorial: true }); }} />
      )}
      {route === 'title' && (
        <Title
          streak={streaks}
          onPlay={() => startRun()}
          onDaily={() => startRun({ daily: true })}
          go={go}
        />
      )}
      {route === 'board' && <Leaderboard onBack={back} />}
      {route === 'respawns' && <Respawns onBack={back} />}
      {route === 'settings' && <Settings onBack={back} go={go} />}
      {route === 'account' && <Account onBack={back} />}
      {route === 'wardrobe' && <Wardrobe onBack={back} />}
      {route === 'credits' && <Credits onBack={back} />}
    </div>
  );
}
