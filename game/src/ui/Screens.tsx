// Every menu. One file because they are all the same shape — a column of
// controls in a scroll view — and splitting nine near-identical screens across
// nine files buys nothing but imports.

import { useEffect, useState } from 'react';
import { Button, Choice, Code, Field, Link, Note, Screen, Section, Spinner, Stack, t } from './kit.tsx';
import * as api from '../net/api.ts';
import { load, save, setSetting, bestFor } from '../store.ts';
import { applyChrome } from '../chrome.ts';
import { SKINS, MODE_ORDER, VERSION, CHAPTERS } from '../engine/constants.ts';
import { pad5 } from './Hud.tsx';

// ------------------------------------------------------------------ title
export function Title({ streak, onPlay, onDaily, go }: {
  streak: { play: number; daily: number };
  onPlay: () => void;
  onDaily: () => void;
  go: (s: string) => void;
}) {
  const s = load();
  const kids = s.settings.mode === 'kids';
  return (
    <Screen>
      <div className="flex min-h-[70vh] flex-col justify-center">
        <div className="mb-1 text-center font-display text-5xl font-bold tracking-tight">DOVEFALL</div>
        <div className="mb-8 text-center text-sm text-dim">{t('tagline')}</div>

        <div className="mb-7 flex justify-center gap-6 text-center">
          <Stat label={t('best')} value={pad5(bestFor(s.settings.mode))} />
          {!kids && <Stat label={t('streak')} value={`${streak.play}`} accent={streak.play > 1} />}
          <Stat label={t('feathers')} value={`${s.feathers}`} />
        </div>

        <Stack>
          <Button primary onClick={onPlay}>{t('play')}</Button>
          {/* Kids mode is deliberately a shorter menu. A daily challenge you
              cannot win, a board you never appear on, and an account screen are
              three doors to nowhere for a six-year-old — so they are not there. */}
          {!kids && <Button onClick={onDaily}>{t('daily')}</Button>}
          {!kids && <Button onClick={() => go('board')}>{t('leaderboard')}</Button>}
          <div className="flex gap-2.5">
            <Button onClick={() => go('wardrobe')}>{t('wardrobe')}</Button>
            <Button onClick={() => go('settings')}>{t('settings')}</Button>
          </div>
        </Stack>

        {!kids && (
          <div className="mt-6 text-center text-xs text-dim">
            {s.name ? <>{s.name} <span className="text-dim/60">{s.tag}</span></> : t('guest')}
            {' · '}
            <button type="button" className="underline underline-offset-2" onClick={() => go('account')}>
              {t('account')}
            </button>
          </div>
        )}
      </div>
    </Screen>
  );
}

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div>
    <div className={`font-display text-2xl font-bold tabular-nums ${accent ? 'text-gold' : ''}`}>{value}</div>
    <div className="text-[0.7rem] uppercase tracking-widest text-dim">{label}</div>
  </div>
);

// ------------------------------------------------------- name (first run)
export function NameScreen({ onDone }: { onDone: (name: string) => void }) {
  const [names, setNames] = useState<string[] | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const suggest = () => {
    setNames(null);
    api.suggestNames().then(setNames).catch(() => setNames([]));
  };
  useEffect(suggest, []);

  const choose = async (name: string) => {
    setBusy(true);
    try {
      // /v1/auth/guest only honours the name when it CREATES the account. Come
      // back to this screen on a phone that already has one and the name would
      // be quietly ignored, so say it a second time when it did not take.
      await api.signInGuest(name);
      if (load().name !== name) await api.setName(name);
    } catch {
      save({ name });
    }
    setBusy(false);
    onDone(name);
  };

  return (
    <Screen title={t('choosename')}>
      <Note>
        No email, no password, nothing to forget. The four characters after your
        name are yours alone, so it stays your name even if someone else picks it.
      </Note>

      <Section>{t('suggest')}</Section>
      {names === null ? <Spinner /> : (
        <Stack>
          {names.length === 0 && <Note>{t('offline')}</Note>}
          {names.map((n) => (
            <Button key={n} onClick={() => choose(n)} disabled={busy}>{n}</Button>
          ))}
        </Stack>
      )}
      <div className="mt-2.5">
        <Button small onClick={suggest} disabled={busy}>{t('threemore')}</Button>
      </div>

      <Section>{t('orname')}</Section>
      <Stack>
        <Field value={typed} onChange={setTyped} placeholder={t('playername')} />
        <Button primary disabled={typed.trim().length < 2 || busy} onClick={() => choose(typed.trim())}>
          {t('savename')}
        </Button>
      </Stack>
    </Screen>
  );
}

// ------------------------------------------------------------- leaderboard
type BoardKind = 'all' | 'daily' | 'streaks';

export function Leaderboard({ onBack }: { onBack: () => void }) {
  const s = load();
  // Kids mode has no board on purpose, so show the one the player would climb
  // if they wanted to. Asking the server for /board/kids would simply 404.
  const boardMode = s.settings.mode === 'kids' ? 'normal' : s.settings.mode;
  const [kind, setKind] = useState<BoardKind>('all');
  const [rows, setRows] = useState<api.BoardEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setErr(null);
    const p = kind === 'all' ? api.board(boardMode)
      : kind === 'daily' ? api.dailyBoard().then((r) => r.entries)
        : api.streakBoard();
    p.then(setRows).catch(() => { setRows([]); setErr(t('nonet')); });
  }, [kind, boardMode]);

  const mine = rows?.find((r) => r.name === s.name && r.tag === s.tag);

  return (
    <Screen title={t('leaderboard')} onBack={onBack}>
      <Choice
        label=""
        value={kind}
        onChange={setKind}
        options={[
          { value: 'all', label: t('alltime') },
          { value: 'daily', label: t('daily') },
          { value: 'streaks', label: t('streak') },
        ]}
      />

      {rows === null ? <Spinner /> : (
        <div className="mt-4">
          {err && <Note>{err}</Note>}
          {rows.map((r) => (
            <Row key={`${r.rank}-${r.tag}`} r={r} me={r.name === s.name && r.tag === s.tag} />
          ))}
          {rows.length > 0 && !mine && (
            <>
              <div className="my-3 h-px bg-slot-2" />
              <Row
                r={{ rank: 0, name: s.name || t('you'), tag: s.tag, score: bestFor(boardMode) }}
                me
              />
            </>
          )}
        </div>
      )}
    </Screen>
  );
}

function Row({ r, me }: { r: api.BoardEntry; me: boolean }) {
  return (
    <div className={[
      'flex items-center gap-3 rounded-xl px-3 py-2.5 font-display text-sm',
      me ? 'bg-gold/15 ring-1 ring-gold/60' : '',
    ].join(' ')}>
      <span className={`w-8 tabular-nums ${r.rank <= 3 ? 'text-gold' : 'text-dim'}`}>
        {r.rank || '—'}
      </span>
      <span className="flex-1 truncate font-sans">
        {r.name} <span className="text-dim/70">{r.tag}</span>
      </span>
      <span className="tabular-nums">{r.current ? `${r.score}/${r.current}` : pad5(r.score)}</span>
    </div>
  );
}

// ------------------------------------------------------------- respawns
export function Respawns({ onBack }: { onBack: () => void }) {
  const [info, setInfo] = useState<api.RespawnInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () => { api.respawns().then(setInfo).catch(() => setMsg('No connection.')); };
  useEffect(refresh, []);

  return (
    <Screen title={t('respawns')} onBack={onBack}>
      <div className="mb-2 text-center font-display text-5xl font-bold text-gold">
        ♥ {info?.respawns ?? 0}
      </div>
      <Note>
        A heart puts you back in the sky exactly where you fell, with the way
        ahead swept clear. {info ? `${info.perPayment} of them` : 'Three'} for
        one payment.
      </Note>
      <Note>
        A run you continue still earns feathers and can still beat your own
        best. It never enters the leaderboard. Nothing here buys rank, and
        nothing here ever will.
      </Note>

      <Section>{t('getrespawns')}</Section>
      <Note>
        Pay {info ? `KES ${info.minKes}` : 'KES 50'} or more, and put this code
        in the payment note — it is the only way we know the payment was yours.
      </Note>
      <Code>{info?.payCode ?? '····  ····'}</Code>
      <div className="mt-2.5">
        <Stack>
          <Button
            small
            onClick={() => info && navigator.clipboard?.writeText(info.payCode).then(
              () => setMsg('Code copied'), () => setMsg(null),
            )}
          >
            {t('copycode')}
          </Button>
          {info?.payUrl && (
            <Button primary onClick={() => window.open(info.payUrl!, '_blank', 'noopener')}>
              {t('paynow')}
            </Button>
          )}
          <Button onClick={() => { setMsg('Looking…'); refresh(); setTimeout(() => setMsg(null), 2000); }}>
            {t('ihavepaid')}
          </Button>
        </Stack>
      </div>
      {msg && <Note>{msg}</Note>}
      <Note>
        Paystack confirms the payment, not this screen. If your hearts have not
        appeared within a minute, tap “{t('ihavepaid')}” again. Nothing is lost
        in the meantime.
      </Note>
    </Screen>
  );
}

// ------------------------------------------------------------- settings
export function Settings({ onBack, go }: { onBack: () => void; go: (s: string) => void }) {
  const [, bump] = useState(0);
  const s = load();
  const set = <K extends keyof typeof s.settings>(k: K, v: (typeof s.settings)[K]) => {
    setSetting(k, v);
    // Theme and text size live on the document, not in React's tree, so a
    // re-render alone changes nothing you can see. This is why tapping "XL"
    // used to do nothing until you left the screen and came back.
    applyChrome();
    bump((n) => n + 1);
  };

  return (
    <Screen title={t('settings')} onBack={onBack}>
      <Section>{t('audio')}</Section>
      <Stack>
        <Choice label={t('sfx')} value={s.settings.sfx ? 1 : 0} onChange={(v) => set('sfx', v === 1)}
          options={[{ value: 0, label: t('off') }, { value: 1, label: t('on') }]} />
        <Choice label={t('haptics')} value={s.settings.haptics ? 1 : 0} onChange={(v) => set('haptics', v === 1)}
          options={[{ value: 0, label: t('off') }, { value: 1, label: t('on') }]} />
      </Stack>

      <Section>{t('visual')}</Section>
      <Stack>
        <Choice label={t('atmosphere')} value={s.settings.atmos} onChange={(v) => set('atmos', v)}
          options={[{ value: 0, label: t('off') }, { value: 1, label: t('reduced') }, { value: 2, label: t('full') }]} />
        <Choice label={t('flashing')} value={s.settings.flashing ? 1 : 0} onChange={(v) => set('flashing', v === 1)}
          options={[{ value: 0, label: t('off') }, { value: 1, label: t('on') }]} />
        <Choice label="Text size" value={s.settings.fontScale} onChange={(v) => set('fontScale', v)}
          options={[{ value: 0, label: 'S' }, { value: 1, label: 'M' }, { value: 2, label: 'L' }, { value: 3, label: 'XL' }]} />
        <Choice label="Theme" value={s.settings.theme} onChange={(v) => set('theme', v)}
          options={[{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </Stack>

      <Section>{t('game')}</Section>
      <Stack>
        <Choice label={t('difficulty')} value={s.settings.mode} onChange={(v) => set('mode', v)}
          options={MODE_ORDER.map((m) => ({ value: m, label: t(m) }))} />
        {s.settings.mode === 'kids' && (
          <Note>
            Kids: no spikes, nothing to dodge, and the sky never speeds up.
            Hearts are free and endless. Scores stay on this phone.
          </Note>
        )}
        <Choice label={t('lefthand')} value={s.settings.lefthand ? 1 : 0} onChange={(v) => set('lefthand', v === 1)}
          options={[{ value: 0, label: t('off') }, { value: 1, label: t('on') }]} />
        <Choice label={t('language')} value={s.settings.lang} onChange={(v) => set('lang', v)}
          options={[{ value: 'en', label: 'English' }, { value: 'sw', label: 'Kiswahili' }]} />
      </Stack>

      <Section>{t('account')}</Section>
      <Stack>
        <Button onClick={() => go('account')}>{t('playername')} · {t('recovery')}</Button>
        <Button onClick={() => go('respawns')}>{t('respawns')}</Button>
      </Stack>

      <Section>{t('about')}</Section>
      <Stack>
        <Button onClick={() => go('credits')}>{t('credits')}</Button>
      </Stack>
      <Note>{t('version')} {VERSION}</Note>
    </Screen>
  );
}

// ------------------------------------------------------------- account
export function Account({ onBack }: { onBack: () => void }) {
  const s = load();
  const [name, setName] = useState(s.name);
  const [code, setCode] = useState<string | null>(null);
  const [entered, setEntered] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Screen title={t('account')} onBack={onBack}>
      <Section>{t('playername')}</Section>
      <Stack>
        <Field value={name} onChange={setName} placeholder={t('playername')} />
        <Button primary onClick={() => api.setName(name.trim())
          .then((m) => { setName(m.name); setMsg(t('saved')); })
          .catch(() => { save({ name: name.trim() }); setMsg('No connection — saved on this phone for now.'); })}>
          {t('savename')}
        </Button>
      </Stack>
      {s.tag && <Note>Your tag is {s.tag}. Change your name as often as you like — the tag is yours for good.</Note>}

      <Section>{t('recovery')}</Section>
      <Note>
        Write this one down somewhere real. It is shown once, it works once, and
        it is the only way back to your name and your scores on a new phone.
      </Note>
      {code && <Code>{code}</Code>}
      <div className="mt-2.5">
        <Button onClick={() => api.issueRecovery().then((r) => setCode(r.code)).catch(() => setMsg('No connection.'))}>
          {t('getcode')}
        </Button>
      </div>

      <Section>New phone?</Section>
      <Stack>
        <Field value={entered} onChange={setEntered} placeholder={t('entercode')} maxLength={19} />
        <Button onClick={() => api.claimRecovery(entered.trim())
          .then((m) => { setName(m.name); setMsg('Restored.'); })
          .catch(() => setMsg('That code is not one of ours — or it has already been used.'))}>
          {t('restoreacct')}
        </Button>
      </Stack>

      <Section>Phones</Section>
      <Note>Two phones at a time. This signs out the other one and leaves you flying.</Note>
      <Button onClick={() => api.signOutOthers()
        .then((r) => setMsg(r.removed ? 'Done — this is the only phone now.' : 'Nothing to do: this is your only phone.'))
        .catch(() => setMsg('No connection.'))}>
        Sign out my other phone
      </Button>

      {msg && <Note>{msg}</Note>}
    </Screen>
  );
}

// ------------------------------------------------------------- wardrobe
export function Wardrobe({ onBack }: { onBack: () => void }) {
  const [, bump] = useState(0);
  const s = load();
  return (
    <Screen title={t('wardrobe')} onBack={onBack}>
      <Note>{s.feathers} {t('feathers').toLowerCase()} in the bank. Fly further, earn more.</Note>
      <div className="mt-3 flex flex-col gap-2.5">
        {SKINS.map((k) => {
          const owned = s.owned.includes(k.id) || k.cost === 0;
          const worn = s.settings.skin === k.id;
          return (
            <button
              key={k.id}
              type="button"
              style={{ minHeight: 56 }}
              onClick={() => {
                if (worn) return;
                if (owned) { setSetting('skin', k.id); bump((n) => n + 1); return; }
                if (s.feathers >= k.cost) {
                  save({ feathers: s.feathers - k.cost, owned: [...s.owned, k.id] });
                  setSetting('skin', k.id);
                  bump((n) => n + 1);
                }
              }}
              className={[
                'flex items-center gap-3 rounded-2xl px-4 text-left',
                worn ? 'bg-copper text-white' : owned ? 'bg-slot-2' : 'bg-slot',
              ].join(' ')}
            >
              <span className="h-6 w-9 rounded-sm" style={{ background: k.W, boxShadow: `inset 0 -6px 0 ${k.G}` }} />
              <span className="flex-1">{k.name}</span>
              <span className="text-sm text-dim">
                {worn ? t('owned') : owned ? t('wear') : `${k.cost} ✦`}
              </span>
            </button>
          );
        })}
      </div>
    </Screen>
  );
}

// ------------------------------------------------------------- credits
export function Credits({ onBack }: { onBack: () => void }) {
  return (
    <Screen title={t('credits')} onBack={onBack}>
      <Section>{t('madeby')}</Section>
      <div className="rounded-2xl bg-slot px-5 py-4">
        <div className="text-lg">Brian Gachichio Karanja</div>
        <div className="text-sm text-dim">Strategy and transformation · Nairobi</div>
        <div className="mt-3 flex gap-2.5">
          <Link href="https://x.com/bgachichio">X</Link>
          <Link href="https://gachichio.org">gachichio.org</Link>
        </div>
      </div>

      <Section>{t('chapters')}</Section>
      <Note>
        The sky changes four times, and each one is a place in the book of
        Jonah. Referenced, never quoted.
      </Note>
      <div className="flex flex-col gap-2">
        {CHAPTERS.map((c) => (
          <div key={c.name} className="flex items-center gap-3 rounded-xl bg-slot px-4 py-3">
            <span className="h-5 w-5 rounded" style={{ background: c.sky }} />
            <span className="flex-1">{c.name}</span>
            <span className="font-display text-xs text-dim">{c.ref}</span>
          </div>
        ))}
      </div>

      <Section>{t('builtwith')}</Section>
      <Note>
        One canvas, a few hundred lines of TypeScript, and Cloudflare's free
        plan. No engine, no download, no app store, no advertising. The whole
        game is smaller than a photograph.
      </Note>

      <Section>{t('website')}</Section>
      <Stack>
        <Link href="https://gachichio.org">gachichio.org</Link>
      </Stack>
      <Note>{t('version')} {VERSION}</Note>
    </Screen>
  );
}

// ------------------------------------------------------------- pause
export function Pause({ onResume, onQuit, go }: {
  onResume: () => void; onQuit: () => void; go: (s: string) => void;
}) {
  return (
    <div
      className="absolute inset-0 grid place-items-center backdrop-blur-sm px-5"
      style={{ background: 'var(--scrim)' }}
    >
      <div className="w-full max-w-md">
        <Stack>
          <Button primary onClick={onResume}>{t('resume')}</Button>
          <Button onClick={() => go('settings')}>{t('settings')}</Button>
          <Button onClick={onQuit}>{t('quit')}</Button>
        </Stack>
      </div>
    </div>
  );
}
