// Menu furniture. The Godot build drew these into the canvas at design units
// and had to fight the viewport scale to clear a 48 px touch target; here they
// are ordinary DOM at ordinary CSS pixels, so the floor is met by construction.

import type { ReactNode } from 'react';
import { STRINGS } from '../engine/constants.ts';
import { load } from '../store.ts';

type Lang = keyof typeof STRINGS;

/** The whole translatable surface of the game is under forty strings, because
 *  the core loop contains no words at all. */
export function t(key: string): string {
  const lang = load().settings.lang as Lang;
  const table = STRINGS[lang] as Record<string, string> | undefined;
  return table?.[key] ?? (STRINGS.en as Record<string, string>)[key] ?? key;
}

export function Screen({ title, children, onBack }: {
  title?: string; children: ReactNode; onBack?: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col bg-ink">
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6">
        <div className="mx-auto w-full max-w-md">
          {title && <h1 className="mb-5 text-3xl font-semibold tracking-tight">{title}</h1>}
          {children}
        </div>
      </div>
      {onBack && (
        <div className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          <div className="mx-auto w-full max-w-md">
            <Button primary onClick={onBack}>{t('back')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Button({ children, onClick, primary, disabled, small }: {
  children: ReactNode; onClick?: () => void;
  primary?: boolean; disabled?: boolean; small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'w-full rounded-2xl px-6 font-medium transition-colors',
        small ? 'min-h-11 text-sm' : 'min-h-13 text-base',
        primary
          ? 'bg-copper text-white hover:bg-copper/90 active:bg-copper/80'
          : 'bg-slot-2 text-paper hover:bg-slot-2/80 active:bg-slot',
        'cursor-pointer',
        disabled ? 'opacity-40' : '',
      ].join(' ')}
      style={{ minHeight: small ? 44 : 52 }}
    >
      {children}
    </button>
  );
}

export const Section = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-7 mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-gold">{children}</h2>
);

export const Note = ({ children }: { children: ReactNode }) => (
  <p className="my-2 text-sm leading-relaxed text-dim">{children}</p>
);

export const Stack = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col gap-2.5">{children}</div>
);

export function Choice<T extends string | number>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[0.95rem]">{label}</div>
      <div className="flex gap-2">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            style={{ minHeight: 44 }}
            className={[
              'flex-1 rounded-xl px-2 text-sm transition-colors',
              'cursor-pointer',
              o.value === value
                ? 'bg-copper text-white'
                : 'bg-slot text-paper hover:bg-slot-2/70 active:bg-slot-2',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field({ value, onChange, placeholder, maxLength = 24 }: {
  value: string; onChange: (v: string) => void; placeholder: string; maxLength?: number;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete="off"
      autoCapitalize="words"
      spellCheck={false}
      style={{ minHeight: 52 }}
      className="w-full select-text rounded-2xl bg-slot px-5 text-base text-paper
                 placeholder:text-dim/60 outline-none focus:bg-slot-2"
    />
  );
}

/** A value to read and copy, never to edit. Wide spacing, because the whole
 *  point of a recovery code is transcribing it correctly. */
export const Code = ({ children }: { children: ReactNode }) => (
  <div className="select-text rounded-2xl bg-slot px-5 py-4 text-center font-display
                  text-xl tracking-[0.18em] text-gold" style={{ minHeight: 52 }}>
    {children}
  </div>
);

export const Spinner = () => (
  <div className="py-6 text-center text-sm text-dim">…</div>
);
