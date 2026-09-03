// Sharing. The growth loop, and the one place where a rendered image beats
// text: a score with a picture of the sky it was flown in gets opened.
//
// Order of preference:
//   1. navigator.share with the image file — the real OS sheet: WhatsApp
//      status, Instagram story, X, everything the phone already has.
//   2. navigator.share with text and a link — every mobile browser has this.
//   3. An X web intent, and the card downloaded so it can be attached by hand.

import { SHARE_URL } from '../net/api.ts';
import { CHAPTERS, SKINS, DOVE_FRAMES } from '../engine/constants.ts';
import { chapterIndex } from '../engine/sim.ts';

const W = 1080;
const H = 1350;   // 4:5 — the tallest a feed will show without cropping

export function makeShareCard(opts: {
  score: number; name: string; tag: string; mode: string; skin: string;
}): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;

  const ch = CHAPTERS[chapterIndex(opts.score)];
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, ch.sky);
  grad.addColorStop(1, ch.mid);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // ground band, so it reads as a place and not a swatch
  g.fillStyle = ch.gnd;
  g.fillRect(0, H * 0.82, W, H * 0.18);

  // the dove, at the size it is in the game
  const skin = SKINS.find((s) => s.id === opts.skin) ?? SKINS[0];
  const pal: Record<string, string> = { W: skin.W, G: skin.G, D: skin.D, E: skin.E, O: skin.O };
  const px = 14;
  const frame = DOVE_FRAMES[1];
  const ox = W / 2 - (16 * px) / 2;
  const oy = H * 0.30;
  for (let r = 0; r < frame.length; r++) {
    for (let col = 0; col < frame[r].length; col++) {
      const colour = pal[frame[r][col]];
      if (!colour) continue;
      g.fillStyle = colour;
      g.fillRect(ox + col * px, oy + r * px, px, px);
    }
  }

  g.textAlign = 'center';
  g.fillStyle = '#EEF4FF';
  g.font = 'bold 190px ui-monospace, Menlo, monospace';
  g.fillText(String(opts.score), W / 2, H * 0.60);

  g.font = '500 40px system-ui, sans-serif';
  g.fillStyle = 'rgba(238,244,255,0.82)';
  g.fillText(`${opts.name} ${opts.tag} · ${opts.mode}`, W / 2, H * 0.66);

  g.font = 'bold 52px system-ui, sans-serif';
  g.fillStyle = '#F0C07A';
  g.fillText('DOVEFALL', W / 2, H * 0.885);
  g.font = '400 34px system-ui, sans-serif';
  g.fillStyle = 'rgba(238,244,255,0.72)';
  g.fillText(SHARE_URL.replace(/^https?:\/\//, ''), W / 2, H * 0.935);

  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('no blob'))), 'image/png');
  });
}

export type ShareOutcome = 'shared' | 'copied' | 'intent' | 'failed';

export async function shareScore(opts: {
  score: number; name: string; tag: string; mode: string; skin: string;
}): Promise<ShareOutcome> {
  const text = `${opts.score} in Dovefall. One touch. Storm, deep and sky.`;
  const nav = navigator as Navigator & {
    canShare?: (d: ShareData) => boolean;
    share?: (d: ShareData) => Promise<void>;
  };

  try {
    const blob = await makeShareCard(opts);
    const file = new File([blob], `dovefall-${opts.score}.png`, { type: 'image/png' });
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], text, url: SHARE_URL });
      return 'shared';
    }
  } catch { /* fall through — an image is a bonus, not the mechanism */ }

  try {
    if (nav.share) {
      await nav.share({ title: 'Dovefall', text, url: SHARE_URL });
      return 'shared';
    }
  } catch (e) {
    // A cancelled sheet is not a failure.
    if ((e as Error).name === 'AbortError') return 'shared';
  }

  try {
    await navigator.clipboard.writeText(`${text} ${SHARE_URL}`);
    return 'copied';
  } catch { /* no clipboard either */ }

  window.open(
    `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SHARE_URL)}`,
    '_blank', 'noopener',
  );
  return 'intent';
}
