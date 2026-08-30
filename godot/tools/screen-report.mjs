#!/usr/bin/env node
// What Dovefall actually measures on a given screen.
//
// The claim this tool exists to check is narrow and worth stating exactly:
//
//   Under stretch/aspect="keep" the VIEWPORT is 1080x1920 on every device.
//   The course, the gap, the dove and the gate placement band are therefore
//   the same numbers everywhere. A bigger screen buys a bigger PICTURE, never
//   a bigger PLAYFIELD.
//
// What does change with the screen is (a) how much letterbox there is, (b) how
// sharp the picture is, and (c) how big a 140-unit button is under a thumb.
// Those are the three things worth measuring per device, so those are what this
// prints.
//
//   node screen-report.mjs                 # the standard device table
//   node screen-report.mjs 448 992 2.857   # one device, measured by hand
//
// To get the numbers for YOUR phone, open the game and read them off the
// browser console — the shell logs `dovefall: viewport ...` on every resize.

const DESIGN_W = 1080;
const DESIGN_H = 1920;

// From Config.gd and Game.gd, transcribed rather than approximated, so the
// bottom of this report is the game's own arithmetic:
//
//   _dsize()  = max(2, round(_vw / 51))          Config.DOVE_DIVISOR
//   dove      = 16 x 10 sprite units x _dsize()  Config.DOVE_W / DOVE_H
//   gap       = dove_h * mode.gap * band.gap_x   normal 4.0, band II 1.0
//   lo0       = _vh * 0.09
//   hi0       = _vh * 0.74 - gap
//   band      = hi0 - lo0                        <- the difficulty knob
const DOVE_DIVISOR = 51;
const DOVE_W = 16;
const DOVE_H = 10;
const MODE_GAP = 4.0;              // "normal"
const BAND_GAP_X = 1.0;            // band II, scores 5-14

// From UiKit.gd. design.md 8.2: 48 CSS px for primary, 44 for secondary.
const TOUCH = [
  ['button / field (ROW)', 168, 48],
  ['choice option (ROW_SECONDARY)', 154, 44],
  ['HUD pause', 154, 44],
];

// width x height in CSS px as the BROWSER reports it, and devicePixelRatio.
// Heights are the visible viewport with normal browser chrome showing, which is
// the worst case; add ~50-100 px when the toolbar collapses or the game is
// added to the home screen.
const DEVICES = [
  ['Pixel 9 Pro        Chrome', 448, 936, 2.857],
  ['Pixel 9 Pro        installed', 448, 992, 2.857],
  ['iPhone 16          Safari', 393, 745, 3],
  ['iPhone 16          installed', 393, 852, 3],
  ['iPhone 16 Pro Max  Safari', 440, 848, 3],
  ['iPhone SE (3rd)    Safari', 375, 553, 2],
  ['Galaxy S24         Chrome', 360, 700, 3],
  ['Pixel 7            Chrome', 412, 780, 2.625],
  ['iPad 10.9          portrait', 820, 1080, 2],
  ['Laptop 1440x900    browser', 1440, 790, 2],
];

function fit(w, h) {
  const scale = Math.min(w / DESIGN_W, h / DESIGN_H);
  const drawnW = DESIGN_W * scale;
  const drawnH = DESIGN_H * scale;
  return {
    scale,
    drawnW,
    drawnH,
    barX: (w - drawnW) / 2,
    barY: (h - drawnH) / 2,
    limitedBy: w / DESIGN_W < h / DESIGN_H ? 'width' : 'height',
  };
}

function row(name, w, h, dpr) {
  const f = fit(w, h);
  const framebufferW = Math.floor(w * dpr);
  // How many device pixels render one design pixel. Below 1.0 the picture is
  // softer than the art; above 1.0 it is supersampled and looks crisp.
  const sharpness = (framebufferW * (f.drawnW / w)) / DESIGN_W;
  const worst = Math.min(...TOUCH.map(([, units, floor]) => (units * f.scale) / floor));
  return { name, w, h, dpr, ...f, framebufferW, sharpness, worst };
}

function report(rows) {
  console.log('\n  Dovefall — what each screen shows\n');
  console.log('  Viewport is 1080x1920 on every row. That is the whole point.\n');
  console.log(
    `  ${'device'.padEnd(30)}${'css'.padStart(10)}${'scale'.padStart(8)}` +
    `${'bars'.padStart(14)}${'sharp'.padStart(8)}${'touch'.padStart(9)}`,
  );
  console.log(`  ${'-'.repeat(79)}`);
  for (const r of rows) {
    const bars = r.barX > 0.5
      ? `${Math.round(r.barX)} px sides`
      : r.barY > 0.5 ? `${Math.round(r.barY)} px t+b` : 'none';
    console.log(
      `  ${r.name.padEnd(30)}${`${r.w}x${r.h}`.padStart(10)}` +
      `${r.scale.toFixed(3).padStart(8)}${bars.padStart(14)}` +
      `${`${r.sharpness.toFixed(2)}x`.padStart(8)}` +
      `${(r.worst >= 1 ? 'pass' : 'FAIL').padStart(9)}`,
    );
  }

  console.log('\n  Touch targets, in CSS px, against the design.md 8.2 floor:\n');
  const narrow = rows.reduce((a, b) => (a.scale <= b.scale ? a : b));
  console.log(`  worst case is ${narrow.name.trim()} at scale ${narrow.scale.toFixed(3)}\n`);
  for (const [label, units, floor] of TOUCH) {
    const px = units * narrow.scale;
    console.log(
      `    ${label.padEnd(32)}${units.toString().padStart(5)} u  ->` +
      `${px.toFixed(1).padStart(7)} CSS px   floor ${floor}   ` +
      `${px >= floor ? 'pass' : 'FAIL'}`,
    );
  }

  console.log('\n  Gameplay geometry — identical on every row above:\n');
  const dsize = Math.max(2, Math.round(DESIGN_W / DOVE_DIVISOR));
  const doveW = DOVE_W * dsize;
  const doveH = DOVE_H * dsize;
  const gap = doveH * MODE_GAP * BAND_GAP_X;
  const band = (DESIGN_H * 0.74 - gap) - DESIGN_H * 0.09;
  console.log(`    viewport            ${DESIGN_W} x ${DESIGN_H}`);
  console.log(`    dove                ${doveW} x ${doveH} px  (sprite pixel ${dsize})`);
  console.log(`    gate gap            ${gap} px`);
  console.log(`    placement band      ${band} px   <- the difficulty knob`);
  console.log('\n    No row above can change any of these four numbers. Screen size');
  console.log('    cannot make the game easier, and the board stays comparable.\n');

  const fails = rows.filter((r) => r.worst < 1);
  if (fails.length) {
    console.log(`  ${fails.length} device(s) below the touch floor:`);
    for (const r of fails) console.log(`    ${r.name.trim()} — scale ${r.scale.toFixed(3)}`);
    console.log('  A portrait phone never lands here; a phone held LANDSCAPE does,');
    console.log('  which is why the shell asks the player to turn it back.\n');
  }
  return fails.length;
}

const args = process.argv.slice(2);
if (args.length >= 2) {
  const [w, h, dpr = 3] = args.map(Number);
  process.exit(report([row('measured', w, h, dpr)]) ? 1 : 0);
}
report(DEVICES.map((d) => row(...d)));
