// Sound, from an oscillator. No files, so there is nothing to download and
// nothing to decode before the first tap — which is the whole reason a web
// game feels slow when it does.

let ctx: AudioContext | null = null;
let muted = false;

export const setMuted = (m: boolean) => { muted = m; };

const TONES: Record<string, { f: number; to: number; ms: number; type: OscillatorType; gain: number }> = {
  flap: { f: 420, to: 620, ms: 70, type: 'square', gain: 0.05 },
  gate: { f: 720, to: 980, ms: 90, type: 'triangle', gain: 0.06 },
  chapter: { f: 300, to: 900, ms: 420, type: 'sine', gain: 0.07 },
  death: { f: 300, to: 90, ms: 380, type: 'sawtooth', gain: 0.07 },
  continue: { f: 500, to: 1200, ms: 300, type: 'sine', gain: 0.07 },
};

export function play(event: string): void {
  const tone = TONES[event];
  if (!tone || muted) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.f, now);
    osc.frequency.exponentialRampToValueAtTime(tone.to, now + tone.ms / 1000);
    gain.gain.setValueAtTime(tone.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + tone.ms / 1000 + 0.02);
  } catch { /* audio is a luxury; never let it break a run */ }
  if (event === 'flap' && !muted) navigator.vibrate?.(8);
  if (event === 'death' && !muted) navigator.vibrate?.(20);
}
