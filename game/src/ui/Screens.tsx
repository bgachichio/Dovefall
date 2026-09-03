// Every menu. One file because they are all the same shape — a column of
// controls in a scroll view — and splitting nine near-identical screens across
// nine files buys nothing but imports.

import { useEffect, useState } from 'react';
import { Button, Choice, Code, Field, Note, Screen, Section, Spinner, Stack, t } from './kit.tsx';
import * as api from '../net/api.ts';
import { load, save, setSetting, bestFor } from '../store.ts';
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
  return (
    <Screen>
      <div className="flex min-h-[70vh] flex-col justify-center">
        <div className="mb-1 text-center font-display text-5xl font-bold tracking-tight">DOVEFALL</div>
        <div className="mb-8 text-center text-sm text-dim">{t('tagline')}</div>

        <div className="mb-7 flex justify-center gap-6 text-center">
          <Stat label={t('best')} value={pad5(bestFor(s.settings.mode))} />
          <Stat label={t('streak')} value={`${streak.play}`} accent={streak.play > 1} />
          <Stat label={t('feathers')} value={`${s.feathers}`} />
        </div>

        <Stack>
          <Button primary onClick={onPlay}>{t('play')}</Button>
          <Button onClick={onDaily}>{t('daily')}</Button>
          <Button onClick={() => go('board')}>{t('leaderboard')}</Button>
          <div className="flex gap-2.5">
            <Button onClick={() => go('wardrobe')}>{t('wardrobe')}</Button>
            <Button onClick={() => go('settings')}>{t('settings')}</Button>
          </div>
        </Stack>

        <div className="mt-6 text-center text-xs text-dim">
          {s.name ? <>{s.name} <span className="text-dim/60">{s.tag}</span></> : 'Playing as a guest'}
          {' · '}
          <button type="button" className="underline underline-offset-2" onClick={() => go('account')}>
            {t('account')}
          </button>
        </div>
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
    try { await api.signInGuest(name); } catch { save({ name }); }
    setBusy(false);
    onDone(name);
  };

  return (
    <Screen title={t('choosename')}>
      <Note>
        No email address, no password. Your name is how the board knows you, and
        a four-character tag keeps it yours even if someone picks the same one.
      </Note>

      <Section>{t('suggest')}</Section>
      {names === null ? <Spinner /> : (
        <Stack>
          {names.length === 0 && <Note>Offline — type a name instead.</Note>}
          {names.map((n) => (
            <Button key={n} onClick={() => choose(n)} disabled={busy}>{n}</Button>
          ))}
        </Stack>
      )}
      <div className="mt-2.5">
        <Button small onClick={suggest} disabled={busy}>Three more</Button>
      </div>

      <Section>{t('playername')}</Section>
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
  const [kind, setKind] = useState<BoardKind>('all');
  const [rows, setRows] = useState<api.BoardEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setErr(null);
    const p = kind === 'all' ? api.board(s.settings.mode)
      : kind === 'daily' ? api.dailyBoard().then((r) => r.entries)
        : api.streakBoard();
    p.then(setRows).catch(() => { setRows([]); setErr('No connection. Your scores are safe on this phone.'); });
  }, [kind, s.settings.mode]);

  const mine = rows?.find((r) => r.name === s.name && r.tag === s.tag);

  return (
    <Screen title={t('leaderboard')} onBack={onBack}>
      <Choice
        label=""
        value={kind}
        onChange={setKind}
        options={[
          { value: 'all', label: 'All time' },
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
                r={{ rank: 0, name: s.name || 'You', tag: s.tag, score: bestFor(s.settings.mode) }}
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
  const [info, setInfo] = useState<{ respawns: number; pay_code: string; pay_url: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () => { api.respawns().then(setInfo).catch(() => setMsg('No connection.')); };
  useEffect(refresh, []);

  return (
    <Screen title={t('respawns')} onBack={onBack}>
      <div className="mb-2 text-center font-display text-5xl font-bold text-gold">
        ♥ {info?.respawns ?? 0}
      </div>
      <Note>
        A respawn puts you back in the sky where you fell, with the way ahead
        cleared. Three for one payment. A continued run earns feathers and can
        set your own best — it never enters the leaderboard, so nothing here
        buys rank.
      </Note>

      <Section>{t('getrespawns')}</Section>
      <Note>
        Pay any amount over KES 50 with the button below, then put this code in
        the payment note so we know it was you.
      </Note>
      <Code>{info?.pay_code ?? '····  ····'}</Code>
      <div className="mt-2.5">
        <Stack>
          <Button
            small
            onClick={() => info && navigator.clipboard?.writeText(info.pay_code).then(
              () => setMsg('Code copied'), () => setMsg(null),
            )}
          >
            {t('copycode')}
          </Button>
          <Button primary onClick={() => info && window.open(info.pay_url, '_blank', 'noopener')}>
            {t('paynow')}
          </Button>
          <Button onClick={() => { setMsg('Checking…'); refresh(); setTimeout(() => setMsg(null), 2000); }}>
            {t('ihavepaid')}
          </Button>
        </Stack>
      </div>
      {msg && <Note>{msg}</Note>}
      <Note>
        Payments are confirmed by Paystack, not by this screen. If it has not
        landed within a minute, tap “{t('ihavepaid')}” again — nothing is lost.
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
    bump((n) => n + 1);
  };

  return (
    <Screen title={t('settings')} onBack={onBack}>
      <Section>{t('audio')}</Section>
      <Stack>
        <Choice label={t('music')} value={s.settings.music} onChange={(v) => set('music', v)}
          options={[{ value: 0, label: t('off') }, { value: 1, label: t('low') }, { value: 2, label: t('full') }]} />
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
          .then((r) => { save({ name: r.name, tag: r.tag }); setMsg('Saved'); })
          .catch(() => setMsg('No connection — saved on this phone.'))}>
          {t('savename')}
        </Button>
      </Stack>
      {s.tag && <Note>Your tag is {s.tag}. It never changes, even if your name does.</Note>}

      <Section>{t('recovery')}</Section>
      <Note>
        Write this code down. It is the only way to get your name and your
        scores back on a new phone, and it is shown once.
      </Note>
      {code && <Code>{code}</Code>}
      <div className="mt-2.5">
        <Button onClick={() => api.issueRecovery().then((r) => setCode(r.code)).catch(() => setMsg('No connection.'))}>
          {t('getcode')}
        </Button>
      </div>

      <Section>Moving to a new phone?</Section>
      <Stack>
        <Field value={entered} onChange={setEntered} placeholder={t('entercode')} maxLength={19} />
        <Button onClick={() => api.claimRecovery(entered.trim())
          .then((r) => { setName(r.name); setMsg('Restored.'); })
          .catch(() => setMsg('That code was not recognised.'))}>
          {t('restoreacct')}
        </Button>
      </Stack>

      <Section>Devices</Section>
      <Note>You can be signed in on two phones. Signing out here signs out the other one.</Note>
      <Button onClick={() => api.signOutOthers().then(() => setMsg('Other devices signed out.')).catch(() => setMsg('No connection.'))}>
        Sign out my other device
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
      <Note>{t('feathers')}: {s.feathers}</Note>
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
        <div className="text-sm text-dim">Design, code and art · Nairobi</div>
      </div>

      <Section>{t('chapters')}</Section>
      <Note>
        Four chapters, each a place in the book of Jonah. Referenced, never
        quoted.
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
        A canvas, about six hundred lines of TypeScript, and Cloudflare's free
        plan. No game engine, no download, no app store.
      </Note>

      <Section>{t('website')}</Section>
      <Note>gachichio.org</Note>
      <Note>{t('version')} {VERSION}</Note>
    </Screen>
  );
}

// ------------------------------------------------------------- pause
export function Pause({ onResume, onQuit, go }: {
  onResume: () => void; onQuit: () => void; go: (s: string) => void;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink/80 backdrop-blur-sm px-5">
      <div className="w-full max-w-md">
        <Stack>
          <Button primary onClick={onResume}>Resume</Button>
          <Button onClick={() => go('settings')}>{t('settings')}</Button>
          <Button onClick={onQuit}>{t('back')}</Button>
        </Stack>
      </div>
    </div>
  );
}
