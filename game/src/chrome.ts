// The settings that change how the game LOOKS rather than how it plays.
//
// Every one of these was already on the Settings screen, already written to
// disk, and already read by absolutely nothing: theme, text size, reduced
// flashing and the left-handed HUD were four switches wired to no bulb. A
// control that remembers your choice and then ignores it is worse than no
// control, because it spends the player's trust as well as their time.
//
// Nothing here touches the simulation. The playfield's colours come from the
// chapter palette and are the same on every device, in every theme, for
// everyone — that is the fairness rule, and a preference must never be able to
// reach it.

import { load, type Settings } from './store.ts';

/** Text size, as a multiplier on the root font size. */
const FONT_SCALE = [0.9, 1, 1.15, 1.3] as const;

export type ResolvedTheme = 'light' | 'dark';

/** 'auto' asks the phone, which is the setting most people never change. */
export function resolveTheme(pref: Settings['theme']): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof matchMedia !== 'function') return 'dark';
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Push every look-and-feel setting at the document. Cheap and idempotent, so
 * the honest thing is to call it whenever one of them changes rather than
 * trying to be clever about which.
 */
export function applyChrome(): void {
  if (typeof document === 'undefined') return;
  const s = load().settings;
  const root = document.documentElement;

  root.dataset.theme = resolveTheme(s.theme);
  root.style.setProperty('--font-scale', String(FONT_SCALE[s.fontScale] ?? 1));
  // Read by the renderer for the death flash and by the CSS for the pulsing
  // respawn button. Photosensitivity is not a preference to be half-honoured.
  root.dataset.flashing = s.flashing ? 'reduced' : 'full';
}

/** True when the player has asked for less flashing, or the OS has. */
export function reducedFlashing(): boolean {
  if (load().settings.flashing) return true;
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Follow the system theme while it is set to Auto.
 *
 * Returns an unsubscribe. Without this, "Auto" means "whatever the phone was
 * doing when the game booted", which is not what the word promises — and on a
 * phone that flips to dark at sunset it is visibly wrong once a day.
 */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: light)');
  const onChange = () => { if (load().settings.theme === 'auto') applyChrome(); };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
