// Sound, from an oscillator. No files, so there is nothing to download and
// nothing to decode before the first tap — which is the whole reason a web
// game feels slow when it does.
//
// The bank is transcribed from autoload/Sfx.gd, frequency for frequency, so
// the web build sounds like the Android build rather than merely making noise:
//
//   flap    tone 560 -> 760   55 ms   square     0.32
//   gate    tone 660 -> 660   60 ms   triangle   0.34   pitched by score
//   pb      arp  700 880 1046 75 ms              0.40
//   death   tone 340 -> 90   160 ms   sawtooth   0.42
//   tap     tone 420 -> 420   35 ms   sine       0.26
//   chapter arp  520 700 880 110 ms              0.30

let ctx: AudioContext | null = null;
let muted = false;

export const setMuted = (m: boolean) => { muted = m; };

interface Tone { from: number; to: number; ms: number; type: OscillatorType; gain: number }
type Voice = { tone: Tone } | { arp: number[]; ms: number; gain: number };

// Godot's gains are engine-relative; 0.18 puts the loudest of them at a level
// a phone speaker can hold without clipping.
const G = 0.18;

const BANK: Record<string, Voice> = {
  flap: { tone: { from: 560, to: 760, ms: 55, type: 'square', gain: 0.32 * G } },
  gate: { tone: { from: 660, to: 660, ms: 60, type: 'triangle', gain: 0.34 * G } },
  death: { tone: { from: 340, to: 90, ms: 160, type: 'sawtooth', gain: 0.42 * G } },
  tap: { tone: { from: 420, to: 420, ms: 35, type: 'sine', gain: 0.26 * G } },
  pb: { arp: [700, 880, 1046], ms: 75, gain: 0.40 * G },
  chapter: { arp: [520, 700, 880], ms: 110, gain: 0.30 * G },
};

function blip(from: number, to: number, ms: number, type: OscillatorType, gain: number, at: number) {
  const c = ctx!;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + ms / 1000);
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  osc.connect(amp).connect(c.destination);
  osc.start(at);
  osc.stop(at + ms / 1000 + 0.02);
}

/** `pitch` multiplies every frequency — Game.gd raises the gate tone by a
 *  semitone every five points, which is most of why a long run feels like it
 *  is going somewhere. */
export function play(event: string, pitch = 1): void {
  const voice = BANK[event];
  if (!voice || muted) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    if ('tone' in voice) {
      const t = voice.tone;
      blip(t.from * pitch, t.to * pitch, t.ms, t.type, t.gain, now);
    } else {
      voice.arp.forEach((f, i) => {
        blip(f * pitch, f * pitch, voice.ms, 'triangle', voice.gain, now + (i * voice.ms) / 1000);
      });
    }
  } catch { /* audio is a luxury; never let it break a run */ }
}

/** Sfx.buzz(). Godot used 12 ms on a flap, 8 on a gate and 20 on a death. */
export function buzz(ms: number): void {
  if (muted) return;
  navigator.vibrate?.(ms);
}

/** The pitch Game.gd uses for the gate tone: a semitone per five points. */
export const gatePitch = (score: number) => Math.pow(1.0595, Math.floor(score / 5));
