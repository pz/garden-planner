import { createElement as h, type ReactElement } from 'react';
import { leafPath, type LeafShape } from './spriteGeometry';

// The top-down plant sprites (ported from the plant sprite sheet): each crop is a rosette of
// leaves, plus whatever identifies it, drawn in a unit space where the plant fits a circle of
// radius 1. `r` is the rosette's turn in degrees. Colors come from the --color-accent-2-* ramp.

type El = ReactElement;

interface LeafOpts {
  /** Compound leaves: leaflet length, width and shape. */
  lf?: [number, number, string?];
  pairs?: number;
  spread?: number;
  ribC?: string;
  ribC2?: string;
  ribW?: number;
  rib?: string;
  n?: number;
  w?: number;
  fine?: boolean;
  veins?: boolean;
  sideVeins?: number;
}

const G = (n: number) => `var(--color-accent-2-${n})`;
const C = {
  glauc: 'oklch(0.56 0.045 205)', glaucL: 'oklch(0.74 0.035 195)', glaucD: 'oklch(0.46 0.045 210)',
  silver: 'oklch(0.72 0.03 165)', silverD: 'oklch(0.6 0.04 160)', grey: 'oklch(0.58 0.05 150)',
  red: 'oklch(0.6 0.17 32)', pep: 'oklch(0.56 0.18 25)', purple: 'oklch(0.42 0.1 318)', yellow: 'oklch(0.86 0.13 95)',
  orange: 'oklch(0.72 0.15 58)', pump: 'oklch(0.68 0.15 55)', pink: 'oklch(0.66 0.15 5)', beet: 'oklch(0.42 0.13 5)',
  blue: 'oklch(0.62 0.11 258)', tan: 'oklch(0.8 0.06 80)', tanD: 'oklch(0.66 0.06 75)', white: 'oklch(0.97 0.01 90)',
  cuc: 'oklch(0.45 0.08 145)', wmel: 'oklch(0.42 0.07 150)', wmelL: 'oklch(0.62 0.08 140)', wood: 'oklch(0.5 0.05 60)',
  vine: 'oklch(0.55 0.06 140)', chardR: 'oklch(0.55 0.17 15)', chardY: 'oklch(0.82 0.14 90)', chardO: 'oklch(0.7 0.15 55)',
};
const EDGE = { stroke: 'var(--color-accent-2-900)', strokeOpacity: 0.28, strokeWidth: 0.022, strokeLinejoin: 'round' };

const stroke = (d: string, col: string, w: number): El => h('path', { d, fill: 'none', stroke: col, strokeWidth: w, strokeLinecap: 'round', strokeLinejoin: 'round' });

function leaf(type: string, ang: number, len: number, wid: number, fill: string, o: LeafOpts = {}): El {
  const els: El[] = [];
  if (type === 'pinnate') {
    const [lfL, lfW, lfT] = o.lf!, pairs = o.pairs || 2;
    els.push(stroke(`M0 0L${len * .92} 0`, o.ribC || fill, o.ribW || .03));
    for (let i = 0; i < pairs; i++) {
      const t = (i + 1) / (pairs + 1) * .9, s = 1 - t * .25, x = t * len;
      [-1, 1].forEach(sg => els.push(h('path', { d: leafPath((lfT || 'oval') as LeafShape, lfL * s, lfW * s), transform: `translate(${x} 0) rotate(${sg * (o.spread || 55)})`, fill, ...EDGE })));
    }
    els.push(h('path', { d: leafPath((lfT || 'oval') as LeafShape, lfL * 1.1, lfW * 1.05), transform: `translate(${len * .9 - lfL * .2} 0)`, fill, ...EDGE }));
  } else if (type === 'feather') {
    const n = o.n || 6, w = o.w || .04; let d = `M0 0L${len} 0`;
    for (let i = 1; i <= n; i++) { const t = i / (n + 1), x = t * len, bl = len * .34 * (1 - t * .6); [-1, 1].forEach(sg => { const a = sg * 42 * Math.PI / 180; d += `M${x} 0l${(Math.cos(a) * bl).toFixed(3)} ${(Math.sin(a) * bl).toFixed(3)}`; if (o.fine) { const x2 = x + Math.cos(a) * bl * .5, y2 = Math.sin(a) * bl * .5; d += `M${x2.toFixed(3)} ${y2.toFixed(3)}l${(bl * .3).toFixed(3)} ${(sg * bl * .05).toFixed(3)}`; } }); }
    els.push(stroke(d, fill, w));
  } else if (type === 'tri') {
    const [lfL, lfW, lfT] = o.lf!, px = len - lfL * .95;
    els.push(stroke(`M0 0L${px} 0`, o.ribC || G(700), .035));
    [-58, 0, 58].forEach(a => els.push(h('path', { d: leafPath((lfT || 'oval') as LeafShape, lfL, lfW), transform: `translate(${px} 0) rotate(${a})`, fill, ...EDGE })));
  } else {
    if (/lobed|round|peltate/.test(type)) els.push(stroke(`M0 0L${len - wid * .85} 0`, o.ribC || G(700), .035));
    els.push(h('path', { d: leafPath(type as LeafShape, len, wid), fill, ...EDGE }));
    if (type === 'peltate') { const cx = len - wid / 2; let d = ''; for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; d += `M${cx} 0l${(Math.cos(a) * wid * .42).toFixed(3)} ${(Math.sin(a) * wid * .42).toFixed(3)}`; } els.push(stroke(d, o.ribC || G(300), .02)); }
    if (/lobed/.test(type) && o.veins !== false) { const cx = len - wid / 2; let d = ''; for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.9; d += `M${cx - wid * .3} 0L${(cx + Math.cos(a) * wid * .38).toFixed(3)} ${(Math.sin(a) * wid * .38).toFixed(3)}`; } els.push(stroke(d, o.ribC2 || 'rgba(255,255,255,.35)', .02)); }
    if (o.rib) els.push(stroke(`M${len * .04} 0L${len * .86} 0`, o.rib, o.ribW || .03));
    if (o.sideVeins) { let d = ''; for (let i = 1; i <= o.sideVeins; i++) { const x = len * (.12 + i * .7 / (o.sideVeins + 1)), l = wid * .32 * (1 - i / (o.sideVeins + 2)); d += `M${x} 0l${l * .8} ${-l}M${x} 0l${l * .8} ${l}`; } els.push(stroke(d, o.rib || G(300), .018)); }
  }
  return h('g', { transform: `rotate(${ang.toFixed(1)})` }, ...els);
}
const ring = <T,>(n: number, rot: number, fn: (a: number, i: number) => T): T[] => { const out: T[] = []; for (let i = 0; i < n; i++) out.push(fn(rot + i * 360 / n, i)); return out; };
const at = (a: number, d: number): [number, number] => { const r = a * Math.PI / 180; return [Math.cos(r) * d, Math.sin(r) * d]; };
const dot = (x: number, y: number, r: number, fill: string, o: object = {}): El => h('circle', { cx: x, cy: y, r, fill, ...o });
function flower(x: number, y: number, s: number, petal: string, center: string, n = 5): El {
  const els: El[] = []; for (let i = 0; i < n; i++) { const [px, py] = at(i * 360 / n, s * .55); els.push(dot(x + px, y + py, s * .48, petal)); }
  els.push(dot(x, y, s * .38, center)); return h('g', null, ...els);
}
function star(x: number, y: number, s: number, fill: string, center: string): El {
  let d = ''; for (let i = 0; i < 10; i++) { const [px, py] = at(i * 36 - 90, i % 2 ? s * .42 : s); d += (i ? 'L' : 'M') + (x + px).toFixed(3) + ' ' + (y + py).toFixed(3); }
  return h('g', null, h('path', { d: d + 'Z', fill, strokeLinejoin: 'round', stroke: fill, strokeWidth: s * .25 }), dot(x, y, s * .25, center));
}
const cuke = (a: number, d: number, l: number, w: number): El => {
  const [x, y] = at(a, d), b = w * .55;
  const body = `M${-l / 2} 0C${-l / 2} ${-w * .55} ${-l * .1} ${-w * .5 - b} ${l * .1} ${-w * .5 - b * .8}C${l * .35} ${-w * .5 - b * .5} ${l / 2} ${-w * .35 - b * .2} ${l / 2} ${-b * .1}C${l / 2} ${w * .4} ${l * .3} ${w * .5 - b * .3} ${l * .05} ${w * .5 - b * .4}C${-l * .2} ${w * .5 - b * .3} ${-l / 2} ${w * .5} ${-l / 2} 0Z`;
  const specks = [-.25, -.05, .15, .3].map((t, i) => dot(t * l, (i % 2 ? -.12 : .05) * w - b * .35 * (1 - Math.abs(t) * 1.5), w * .07, C.wmelL));
  return h('g', null, ...(d ? [stroke(`M0 0Q${at(a - 25, d * .5).join(' ')} ${at(a, d - l / 2).join(' ')}`, C.vine, .03)] : []),
    h('g', { transform: `translate(${x} ${y}) rotate(${a})` }, h('path', { d: body, fill: C.cuc, ...EDGE }), ...specks, dot(-l / 2 + w * .1, 0, w * .16, G(700))));
};
const tendril = (a: number, d: number, s: number, col: string): El => { const [x, y] = at(a, d); return h('path', { d: `M${x} ${y}c${s * .5} ${-s * .4} ${s} 0 ${s * .7} ${s * .4}c${-s * .25} ${s * .3} ${-s * .55} 0 ${-s * .3} ${-s * .2}`, fill: 'none', stroke: col, strokeWidth: .02, strokeLinecap: 'round', transform: `rotate(${a} ${x} ${y})` }); };

export const SPR: Record<string, (r: number) => El[]> = {
  tomato: (r: number) => [...ring(6, r, a => leaf('pinnate', a, .98, 0, G(600), { pairs: 3, lf: [.3, .17, 'oval'], ribC: G(700) })), ...ring(4, r + 45, a => leaf('pinnate', a, .55, 0, G(500), { pairs: 2, lf: [.22, .13, 'oval'] })),
    h('g', { transform: 'translate(0 .03)' },
      h('path', { d: 'M0 -.2C.13 -.3 .34 -.25 .34 -.02C.34 .21 .17 .29 0 .29C-.17 .29 -.34 .21 -.34 -.02C-.34 -.25 -.13 -.3 0 -.2Z', fill: C.red, ...EDGE }),
      h('path', { d: 'M-.05 -.16Q0 -.02 .05 -.16', fill: 'none', stroke: 'oklch(0.5 0.15 30)', strokeWidth: .02, strokeLinecap: 'round' }),
      h('ellipse', { cx: -.15, cy: -.06, rx: .06, ry: .09, fill: 'white', opacity: .35, transform: 'rotate(-25 -.15 -.06)' }),
      h('path', { d: 'M0 -.21L-.17 -.25L-.06 -.19L-.12 -.1L0 -.17L.12 -.1L.06 -.19L.17 -.25Z', fill: G(600), stroke: G(600), strokeWidth: .02, strokeLinejoin: 'round' }),
      h('path', { d: 'M0 -.21Q.01 -.29 .05 -.32', fill: 'none', stroke: G(700), strokeWidth: .04, strokeLinecap: 'round' }))],
  pepper: (r: number) => [...ring(6, r, a => leaf('lance', a, .92, .42, G(700), { rib: G(500) })), ...ring(4, r + 30, a => leaf('lance', a, .5, .3, G(600))),
    h('g', { transform: 'rotate(-25) translate(0 -.04)' },
      h('path', { d: 'M-.14 -.28C-.07 -.33 .07 -.33 .14 -.28C.19 -.21 .17 -.06 .13 .1C.09 .26 .07 .38 .11 .48C.13 .53 .1 .55 .06 .52C.0 .46 -.05 .36 -.08 .22C-.11 .08 -.17 -.06 -.17 -.16C-.17 -.22 -.16 -.26 -.14 -.28Z', fill: 'oklch(0.84 0.15 92)', ...EDGE }),
      h('path', { d: 'M-.05 -.26Q-.06 .05 0 .3Q.03 .4 .07 .46M.06 -.26Q.07 .02 .05 .3', fill: 'none', stroke: 'oklch(0.72 0.14 85)', strokeWidth: .018, strokeLinecap: 'round' }),
      h('ellipse', { cx: -.07, cy: -.1, rx: .025, ry: .09, fill: 'white', opacity: .4 }),
      h('path', { d: 'M-.11 -.29Q0 -.35 .11 -.29Q0 -.25 -.11 -.29Z', fill: G(600), stroke: G(600), strokeWidth: .03, strokeLinejoin: 'round' }),
      h('path', { d: 'M0 -.3Q-.01 -.39 .06 -.43', fill: 'none', stroke: G(700), strokeWidth: .045, strokeLinecap: 'round' }))],
  eggplant: (r: number) => [...ring(5, r, a => leaf('oval', a, .98, .62, C.grey, { rib: C.purple, ribW: .035 })), ...ring(3, r + 36, a => leaf('oval', a, .5, .38, G(600))),
    h('g', { transform: 'rotate(-20) scale(1.35) translate(0 -.03)' },
      h('path', { d: 'M0 -.2C.09 -.2 .12 -.12 .14 -.04C.18 .1 .2 .2 .14 .28C.09 .35 -.09 .35 -.14 .28C-.2 .2 -.18 .1 -.14 -.04C-.12 -.12 -.09 -.2 0 -.2Z', fill: C.purple, ...EDGE }),
      h('ellipse', { cx: -.07, cy: .08, rx: .03, ry: .1, fill: 'white', opacity: .25 }),
      h('path', { d: 'M-.12 -.1L-.09 -.2L-.03 -.13L0 -.23L.03 -.13L.09 -.2L.12 -.1Q0 -.06 -.12 -.1Z', fill: G(600), stroke: G(600), strokeWidth: .025, strokeLinejoin: 'round' }),
      h('path', { d: 'M0 -.21L0 -.33', fill: 'none', stroke: G(700), strokeWidth: .045, strokeLinecap: 'round' }))],
  potato: (r: number) => [...ring(6, r, a => leaf('pinnate', a, .92, 0, G(700), { pairs: 2, lf: [.3, .22, 'oval'], spread: 60 })), ...ring(3, r + 30, a => leaf('pinnate', a, .5, 0, G(600), { pairs: 1, lf: [.22, .16, 'oval'] })),
    ...ring(3, r + 15, a => { const [x, y] = at(a, .22); return flower(x, y, .08, C.white, C.yellow); })],
  cucumber: (r: number) => [...ring(5, r, a => leaf('lobed', a, .92, .54, G(500))), cuke(r + 20, 0, .82, .27)],
  zucchini: (r: number) => [...ring(5, r, a => leaf('lobed', a, 1, .64, G(600))), ...ring(3, r + 36, a => leaf('lobed', a, .58, .4, G(500))),
    (() => { const l = .86, w = .25; return h('g', { transform: `rotate(${r + 20})` },
      h('path', { d: `M${-l / 2} ${-w * .38}Q${-l / 2} ${-w * .45} ${-l * .3} ${-w * .45}L${l * .38} ${-w * .5}Q${l / 2} ${-w * .5} ${l / 2} 0Q${l / 2} ${w * .5} ${l * .38} ${w * .5}L${-l * .3} ${w * .45}Q${-l / 2} ${w * .45} ${-l / 2} ${w * .38}Z`, fill: 'oklch(0.4 0.07 145)', ...EDGE }),
      stroke(`M${-l * .3} ${-w * .15}L${l * .4} ${-w * .17}M${-l * .3} ${w * .15}L${l * .4} ${w * .17}`, 'oklch(0.55 0.08 140)', .018),
      h('rect', { x: -l / 2 - .06, y: -.035, width: .09, height: .07, rx: .025, fill: G(700) })); })()],
  squash: (r: number) => [...ring(5, r, a => leaf('lobed', a, .98, .62, G(500))),
    h('g', null, dot(0, 0, .3, C.pump, EDGE), h('path', { d: 'M-.3 0Q0 -.16 .3 0M-.3 0Q0 .16 .3 0M0 -.3Q-.14 0 0 .3M0 -.3Q.14 0 0 .3', fill: 'none', stroke: 'oklch(0.55 0.13 50)', strokeWidth: .022 }), dot(0, 0, .055, G(800)))],
  watermelon: (r: number) => [...ring(8, r, a => leaf('deeplobed', a, .95, .38, C.vine, { veins: false })),
    h('g', { transform: `rotate(${r + 20})` }, h('ellipse', { rx: .4, ry: .28, fill: C.wmel, ...EDGE }), ...[-.16, -.05, .05, .16].map(o => h('path', { d: `M-.36 ${o * .7}Q0 ${o * 1.5} .36 ${o * .7}`, fill: 'none', stroke: C.wmelL, strokeWidth: .04, strokeLinecap: 'round' })))],
  melon: (r: number) => [...ring(6, r, a => leaf('round', a, .88, .46, G(500))),
    h('g', null, dot(0, 0, .28, C.tan, EDGE), h('path', { d: 'M-.2 -.2L.2 .2M.2 -.2L-.2 .2M-.27 0L.27 0M0 -.27L0 .27M-.1 -.25L.25 .1M.1 -.25L-.25 .1M-.25 -.1L.1 .25M.25 -.1L-.1 .25', stroke: C.tanD, strokeWidth: .016 }), dot(0, 0, .04, G(700)))],
  kale: (r: number) => [...ring(7, r, a => leaf('ruffle', a, 1, .36, C.glauc, { rib: C.glaucL })), ...ring(4, r + 25, a => leaf('ruffle', a, .55, .3, C.glaucD, { rib: C.glaucL }))],
  broccoli: (r: number) => [...ring(7, r, a => leaf('oval', a, 1, .46, C.glauc, { rib: C.glaucL })), dot(0, 0, .44, G(800)), ...ring(9, r, a => { const [x, y] = at(a, .3); return dot(x, y, .13, G(700), EDGE); }), ...ring(5, r + 36, a => { const [x, y] = at(a, .13); return dot(x, y, .11, G(600), EDGE); }), dot(0, 0, .1, G(600), EDGE)],
  brussels: (r: number) => [...ring(8, r, a => leaf('round', a, .62, .38, C.glauc)), ...ring(4, r + 45, a => leaf('round', a, .32, .22, C.glaucD)), ...ring(6, r + 10, a => { const [x, y] = at(a, .72); return dot(x, y, .08, G(400), EDGE); })],
  collards: (r: number) => [...ring(5, r, a => leaf('paddle', a, 1, .64, C.glauc, { rib: C.glaucL, ribW: .045 })), ...ring(3, r + 36, a => leaf('paddle', a, .5, .36, C.glaucD, { rib: C.glaucL }))],
  cabbage: (r: number) => [...ring(6, r, a => leaf('round', a, .98, .62, C.glaucL)), dot(0, 0, .44, G(300), EDGE), dot(0, 0, .3, G(200), EDGE), dot(0, 0, .16, G(100), EDGE)],
  carrot: (r: number) => [...ring(6, r, a => leaf('feather', a, 1, 0, G(500), { n: 5, w: .05 })), ...ring(5, r + 30, a => leaf('feather', a, .65, 0, G(400), { n: 3, w: .045 })), dot(0, 0, .17, C.orange)],
  beet: (r: number) => [...ring(5, r, a => leaf('oval', a, .95, .46, G(700), { rib: C.beet, ribW: .05 })), dot(0, 0, .2, C.beet)],
  radish: (r: number) => [...ring(5, r, a => leaf('obovate', a, .88, .52, G(500), { rib: G(300) })), dot(0, 0, .18, C.pink)],
  lettuce: (r: number) => [...ring(8, r, a => leaf('ruffle', a, .98, .6, G(300))), ...ring(5, r + 20, a => leaf('ruffle', a, .62, .5, G(400))), ...ring(3, r, a => leaf('obovate', a, .3, .26, G(500)))],
  spinach: (r: number) => [...ring(6, r, a => leaf('spade', a, .94, .56, G(700), { rib: G(500) })), ...ring(4, r + 30, a => leaf('spade', a, .5, .34, G(600)))],
  chard: (r: number) => [...ring(5, r, (a, i) => leaf('paddle', a, 1, .56, G(700), { rib: [C.chardR, C.chardY, C.chardO][i % 3], ribW: .07 })), dot(0, 0, .1, C.chardR)],
  basil: (r: number) => [...ring(4, r, a => leaf('basil', a, .96, .58, G(400), { rib: G(200), sideVeins: 3 })), ...ring(4, r + 45, a => leaf('basil', a, .62, .42, G(500), { rib: G(300), sideVeins: 2 })), ...ring(2, r + 90, a => leaf('basil', a, .3, .22, G(500), { rib: G(300) }))],
  dill: (r: number) => [...ring(5, r, a => leaf('feather', a, 1, 0, G(500), { n: 6, w: .05, fine: true })),
    ...ring(2, r + 36, a => { const [x, y] = at(a, .38), els = []; for (let i = 0; i < 8; i++) { const [px, py] = at(i * 45, .13); els.push(stroke(`M${x} ${y}l${px} ${py}`, G(500), .015), dot(x + px, y + py, .035, C.yellow)); } return h('g', null, ...els); })],
  parsley: (r: number) => [...ring(6, r, a => leaf('pinnate', a, .92, 0, G(700), { pairs: 2, lf: [.24, .22, 'lobed'], spread: 50 })), ...ring(3, r + 30, a => leaf('pinnate', a, .45, 0, G(600), { pairs: 1, lf: [.18, .16, 'lobed'] }))],
  cilantro: (r: number) => [...ring(7, r, a => leaf('pinnate', a, .9, 0, G(500), { pairs: 1, lf: [.22, .26, 'round'], spread: 60 })), ...ring(4, r + 25, a => leaf('feather', a, .45, 0, G(400), { n: 3, w: .03 }))],
  onion: (r: number) => [...ring(4, r, a => leaf('strap', a, 1, .14, G(500), { rib: G(400), ribW: .02 })), dot(0, 0, .22, C.white, { stroke: 'var(--color-neutral-500)', strokeWidth: .03 })],
  garlic: (r: number) => [...[0, 180, 25, 205, -25, 155].map((o, i) => leaf('lance', r + o, i < 2 ? 1 : .75, .17, G(700), { rib: G(500), ribW: .02 })), dot(0, 0, .2, C.white, { stroke: 'oklch(0.7 0.06 330)', strokeWidth: .03 })],
  marigold: (r: number) => [...ring(6, r, a => leaf('pinnate', a, .9, 0, G(800), { pairs: 4, lf: [.17, .07, 'lance'], spread: 50 })), ...ring(11, r, a => { const [x, y] = at(a, .2); return dot(x, y, .1, C.orange); }), dot(0, 0, .15, 'oklch(0.62 0.16 45)')],
  borage: (r: number) => [...ring(6, r, a => leaf('ovate', a, .98, .46, 'oklch(0.72 0.07 140)', { rib: 'oklch(0.86 0.04 130)', sideVeins: 3 })), ...ring(6, r + 30, a => leaf('ovate', a, .78, .4, 'oklch(0.69 0.07 141)', { rib: 'oklch(0.85 0.04 130)', sideVeins: 2 })), ...ring(5, r + 12, a => leaf('ovate', a, .5, .28, 'oklch(0.66 0.07 142)', { rib: 'oklch(0.84 0.04 130)' })), ...ring(4, r + 30, a => { const [x, y] = at(a, .46); return star(x, y, .12, C.blue, 'var(--color-neutral-900)'); })],
  nasturtium: (r: number) => [...ring(7, r, a => leaf('peltate', a, .86, .56, G(400))), ...ring(3, r + 25, a => { const [x, y] = at(a, .44); return flower(x, y, .17, C.orange, C.yellow); })],
  corn: (r: number) => { const out = []; for (let i = 0; i < 9; i++) out.push(leaf('lance', r + i * 137.5, .7 + (i % 3) * .14, .17, G(500), { rib: G(300), ribW: .02 })); let d = ''; for (let i = 0; i < 7; i++) { const [x, y] = at(r + i * 51, .2); d += `M0 0L${x} ${y}`; } out.push(stroke(d, C.tanD, .035), dot(0, 0, .06, C.tan));
    const ca = r + 160, [cx, cy] = at(ca, .4), kern = [];
    for (let i = 0; i < 5; i++) for (let j = -1; j <= 1; j++) kern.push(dot(-.13 + i * .065, j * .045, .024, 'oklch(0.78 0.14 85)'));
    out.push(h('g', { transform: `translate(${cx} ${cy}) rotate(${ca}) scale(1.7)` },
      h('path', { d: 'M-.2 0C-.18 -.12 .02 -.14 .2 -.02L.24 0L.2 .02C.02 .14 -.18 .12 -.2 0Z', fill: G(400), ...EDGE }),
      h('rect', { x: -.17, y: -.075, width: .3, height: .15, rx: .075, fill: C.yellow, ...EDGE }), ...kern,
      h('path', { d: 'M-.2 0C-.12 -.05 -.02 -.1 .06 -.09M-.2 0C-.12 .05 -.02 .1 .06 .09', fill: 'none', stroke: G(500), strokeWidth: .03, strokeLinecap: 'round' }),
      stroke('M.14 0l.1 -.03M.14 0l.11 .01M.14 0l.09 .04', C.tanD, .018)));
    return out; },
  bean: (r: number) => [...ring(5, r, a => leaf('tri', a, .9, 0, G(500), { lf: [.42, .34, 'oval'] })), ...ring(3, r + 36, a => tendril(a, .5, .3, G(600))), ...ring(2, r + 36, a => { const [x, y] = at(a, .25); return flower(x, y, .07, C.white, G(300)); })],
  polebean: (r: number) => [...ring(4, r, a => leaf('tri', a, .92, 0, G(600), { lf: [.44, .36, 'oval'] })), ...ring(4, r + 45, a => leaf('tri', a, .5, 0, G(500), { lf: [.24, .2, 'oval'] })), ...ring(5, r + 20, a => tendril(a, .58, .34, G(600))), dot(0, 0, .14, C.wood, { stroke: 'oklch(0.4 0.05 60)', strokeWidth: .03 }), dot(0, 0, .05, 'oklch(0.4 0.05 60)'), h('path', { d: 'M.2 0C.2 .14 .06 .22 -.06 .2C-.2 .17 -.24 .02 -.18 -.09C-.12 -.2 .04 -.24 .13 -.17', fill: 'none', stroke: G(600), strokeWidth: .035, strokeLinecap: 'round', transform: `rotate(${r})` })],
  pea: (r: number) => [...ring(6, r, a => leaf('pinnate', a, .8, 0, G(300), { pairs: 1, lf: [.3, .26, 'oval'], ribC: G(500) })), ...ring(3, r + 30, a => tendril(a, .55, .3, G(500))), ...ring(2, r + 90, a => { const [x, y] = at(a, .22); return flower(x, y, .08, C.white, G(200)); })],
  strawberry: (r: number) => [...ring(5, r, a => leaf('tri', a, .82, 0, G(600), { lf: [.38, .32, 'serrate'] })), ...ring(3, r + 36, a => { const [x, y] = at(a, .46); return h('g', { transform: `translate(${x} ${y}) rotate(${a + 180})` }, h('path', { d: 'M-.17 0C-.17 -.12 -.05 -.16 .02 -.15C.12 -.12 .2 -.05 .2 0C.2 .05 .12 .12 .02 .15C-.05 .16 -.17 .12 -.17 0Z', fill: C.red, ...EDGE }), ...[[-.05, -.06], [.05, -.07], [-.05, .06], [.05, .07], [.12, 0], [-.1, 0], [.01, 0]].map(([px, py]) => dot(px, py, .013, C.yellow)), h('path', { d: 'M-.17 0L-.24 -.08L-.2 0L-.24 .08Z', fill: G(600), stroke: G(600), strokeWidth: .03, strokeLinejoin: 'round' })); }), flower(0, 0, .09, C.white, C.yellow)],
  artichoke: (r: number) => [...ring(8, r, a => leaf('serrate', a, 1, .34, C.silver, { rib: C.white, ribW: .025 })), dot(0, 0, .26, C.silverD, EDGE), ...ring(8, r + 22, a => { const [x, y] = at(a, .15); return dot(x, y, .075, G(600), EDGE); }), dot(0, 0, .08, C.purple)],
};
const RIB = 'rgba(255,255,255,.35)';
export const LEAF_COLORS: { id: string; c: string }[] = [['sage', G(500)], ['light', G(300)], ['dark', G(700)], ['blue', C.glauc], ['silver', C.silver], ['lime', 'oklch(0.74 0.12 125)'], ['red', 'oklch(0.48 0.1 15)']].map(([id, c]) => ({ id, c }));
export const ACCENTS: { id: string; c: string | null }[] = ([['none', null], ['red', C.red], ['orange', C.orange], ['yellow', C.yellow], ['pink', C.pink], ['purple', C.purple], ['blue', C.blue], ['white', C.white]] as [string, string | null][]).map(([id, c]) => ({ id, c }));
const fruitRing = (r: number, A: string) => ring(3, r + 40, a => { const [x, y] = at(a, .44); return h('g', null, dot(x, y, .13, A, EDGE), dot(x - .04, y - .04, .035, 'white', { opacity: .35 })); });
const GENERIC: Record<string, (r: number, L: string, A: string | null) => El[]> = {
  mound: (r: number, L: string, A: string | null) => [...ring(7, r, a => leaf('oval', a, .96, .5, L, { rib: RIB })), ...ring(4, r + 25, a => leaf('oval', a, .55, .36, L, { rib: RIB })), ...(A ? fruitRing(r, A) : [])],
  rosette: (r: number, L: string, A: string | null) => [...ring(9, r, a => leaf('obovate', a, .95, .5, L, { rib: RIB })), ...ring(5, r + 20, a => leaf('obovate', a, .55, .4, L)), A ? dot(0, 0, .2, A, EDGE) : dot(0, 0, .1, L, EDGE)],
  ruffled: (r: number, L: string, A: string | null) => [...ring(8, r, a => leaf('ruffle', a, .98, .55, L)), ...ring(5, r + 20, a => leaf('ruffle', a, .6, .45, L)), ...(A ? [dot(0, 0, .16, A, EDGE)] : [])],
  upright: (r: number, L: string, A: string | null) => [...ring(5, r, a => leaf('strap', a, 1, .16, L, { rib: RIB, ribW: .02 })), ...ring(3, r + 36, a => leaf('strap', a, .62, .14, L)), A ? dot(0, 0, .2, A, EDGE) : dot(0, 0, .08, L)],
  feathery: (r: number, L: string, A: string | null) => [...ring(6, r, a => leaf('feather', a, 1, 0, L, { n: 5, w: .05 })), ...ring(5, r + 30, a => leaf('feather', a, .65, 0, L, { n: 3, w: .045 })), ...(A ? [dot(0, 0, .17, A)] : [])],
  bushy: (r: number, L: string, A: string | null) => [...ring(6, r, a => leaf('pinnate', a, .96, 0, L, { pairs: 3, lf: [.28, .16, 'oval'] })), ...ring(4, r + 45, a => leaf('pinnate', a, .55, 0, L, { pairs: 2, lf: [.2, .12, 'oval'] })), ...(A ? fruitRing(r, A) : [])],
  vining: (r: number, L: string, A: string | null) => [...ring(5, r, a => leaf('lobed', a, .95, .58, L)), ...ring(3, r + 36, a => tendril(a, .55, .32, L)), ...(A ? [dot(0, 0, .26, A, EDGE)] : [])],
  spiky: (r: number, L: string, A: string | null) => [...ring(8, r, a => leaf('serrate', a, 1, .3, L, { rib: RIB, ribW: .025 })), A ? dot(0, 0, .22, A, EDGE) : dot(0, 0, .12, L, EDGE)],
};
export const SHAPES: { id: string; label: string }[] = [['mound', 'Leafy mound'], ['rosette', 'Rosette'], ['ruffled', 'Ruffled'], ['upright', 'Upright'], ['feathery', 'Feathery'], ['bushy', 'Bushy'], ['vining', 'Vining'], ['spiky', 'Spiky']].map(([id, label]) => ({ id, label }));
/** A user-made plant's look: like a built-in plant, or a generic shape with leaf and flower/fruit colors. */
export interface CropSpec {
  like?: string;
  shape?: string;
  leaf?: string;
  accent?: string;
}

/** The sprite for a user-made plant, in the same unit space as the built-in ones. */
export function drawSpec(spec: CropSpec, rotation: number): El {
  if (spec.like && SPR[spec.like]) return h('g', null, ...SPR[spec.like](rotation));
  const leafColor = (LEAF_COLORS.find((x) => x.id === spec.leaf) ?? LEAF_COLORS[0]).c;
  const accent = (ACCENTS.find((x) => x.id === spec.accent) ?? ACCENTS[0]).c;
  return h('g', null, ...(GENERIC[spec.shape ?? ''] ?? GENERIC.mound)(rotation, leafColor, accent));
}

/** The built-in sprite for a sprite-sheet key, or null if there isn't one. */
export function drawCrop(key: string, rotation: number): El | null {
  const draw = SPR[key];
  return draw ? h('g', null, ...draw(rotation)) : null;
}
