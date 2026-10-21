import type { ReactNode } from 'react';
import {
  featherPath,
  leafPath,
  polar,
  spokes,
  type LeafShape,
} from '../spriteGeometry';

// Top-down botanical sprites, one per crop: a rosette of leaves (plus the fruit, root crown or
// flowers that identify the crop) drawn in a unit space where the plant fits a circle of
// radius 1. Colors come from the --color-accent-2-* ramp so they follow the theme.

const G = (n: number) => `var(--color-accent-2-${n})`;
const C = {
  glauc: 'oklch(0.56 0.045 205)',
  glaucL: 'oklch(0.74 0.035 195)',
  glaucD: 'oklch(0.46 0.045 210)',
  red: 'oklch(0.6 0.17 32)',
  yellow: 'oklch(0.86 0.13 95)',
  orange: 'oklch(0.72 0.15 58)',
  pump: 'oklch(0.68 0.15 55)',
  white: 'oklch(0.97 0.01 90)',
};
const EDGE = {
  stroke: 'var(--color-accent-2-900)',
  strokeOpacity: 0.28,
  strokeWidth: 0.022,
  strokeLinejoin: 'round',
} as const;
const RIB = 'rgba(255,255,255,.35)';

function Stroke({ d, color, w }: { d: string; color: string; w: number }) {
  return <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
}

function Dot({ x, y, r, fill, edge }: { x: number; y: number; r: number; fill: string; edge?: object }) {
  return <circle cx={x} cy={y} r={r} fill={fill} {...edge} />;
}

/** A single-blade leaf, optionally with a midrib, side veins, or (lobed) palmate veins. */
function Leaf({
  shape,
  ang,
  len,
  wid,
  fill,
  rib,
  ribW = 0.03,
  sideVeins = 0,
}: {
  shape: LeafShape;
  ang: number;
  len: number;
  wid: number;
  fill: string;
  rib?: string;
  ribW?: number;
  sideVeins?: number;
}) {
  const lobed = shape === 'lobed';
  const cx = len - wid / 2;
  let veins = '';
  if (lobed) {
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.9;
      veins += `M${cx - wid * 0.3} 0L${(cx + Math.cos(a) * wid * 0.38).toFixed(3)} ${(Math.sin(a) * wid * 0.38).toFixed(3)}`;
    }
  }
  let side = '';
  for (let i = 1; i <= sideVeins; i++) {
    const x = len * (0.12 + (i * 0.7) / (sideVeins + 1));
    const l = wid * 0.32 * (1 - i / (sideVeins + 2));
    side += `M${x} 0l${l * 0.8} ${-l}M${x} 0l${l * 0.8} ${l}`;
  }
  return (
    <g transform={`rotate(${ang.toFixed(1)})`}>
      {lobed && <Stroke d={`M0 0L${len - wid * 0.85} 0`} color={G(700)} w={0.035} />}
      <path d={leafPath(shape, len, wid)} fill={fill} {...EDGE} />
      {lobed && <Stroke d={veins} color={RIB} w={0.02} />}
      {rib && <Stroke d={`M${len * 0.04} 0L${len * 0.86} 0`} color={rib} w={ribW} />}
      {sideVeins > 0 && <Stroke d={side} color={rib ?? G(300)} w={0.018} />}
    </g>
  );
}

/** A leaf stem with `pairs` leaflet pairs and one terminal leaflet (tomato). */
function Pinnate({ ang, len, fill, pairs, lf, ribC }: { ang: number; len: number; fill: string; pairs: number; lf: [number, number]; ribC?: string }) {
  const [lfL, lfW] = lf;
  const leaflets: ReactNode[] = [];
  for (let i = 0; i < pairs; i++) {
    const t = ((i + 1) / (pairs + 1)) * 0.9;
    const s = 1 - t * 0.25;
    for (const sg of [-1, 1]) {
      leaflets.push(
        <path key={`${i}${sg}`} d={leafPath('oval', lfL * s, lfW * s)} transform={`translate(${t * len} 0) rotate(${sg * 55})`} fill={fill} {...EDGE} />,
      );
    }
  }
  return (
    <g transform={`rotate(${ang.toFixed(1)})`}>
      <Stroke d={`M0 0L${len * 0.92} 0`} color={ribC ?? fill} w={0.03} />
      {leaflets}
      <path d={leafPath('oval', lfL * 1.1, lfW * 1.05)} transform={`translate(${len * 0.9 - lfL * 0.2} 0)`} fill={fill} {...EDGE} />
    </g>
  );
}

/** Three leaflets on a stalk (bean). */
function Trifoliate({ ang, len, fill, lf }: { ang: number; len: number; fill: string; lf: [number, number] }) {
  const [lfL, lfW] = lf;
  const px = len - lfL * 0.95;
  return (
    <g transform={`rotate(${ang.toFixed(1)})`}>
      <Stroke d={`M0 0L${px} 0`} color={G(700)} w={0.035} />
      {[-58, 0, 58].map((a) => (
        <path key={a} d={leafPath('oval', lfL, lfW)} transform={`translate(${px} 0) rotate(${a})`} fill={fill} {...EDGE} />
      ))}
    </g>
  );
}

function Feather({ ang, len, fill, n, w }: { ang: number; len: number; fill: string; n: number; w: number }) {
  return (
    <g transform={`rotate(${ang.toFixed(1)})`}>
      <Stroke d={featherPath(len, n)} color={fill} w={w} />
    </g>
  );
}

function Flower({ x, y, s, petal, center }: { x: number; y: number; s: number; petal: string; center: string }) {
  return (
    <g>
      {spokes(5, 0).map((a) => {
        const [px, py] = polar(a, s * 0.55);
        return <Dot key={a} x={x + px} y={y + py} r={s * 0.48} fill={petal} />;
      })}
      <Dot x={x} y={y} r={s * 0.38} fill={center} />
    </g>
  );
}

function Tendril({ ang, dist, s }: { ang: number; dist: number; s: number }) {
  const [x, y] = polar(ang, dist);
  const d = `M${x} ${y}c${s * 0.5} ${-s * 0.4} ${s} 0 ${s * 0.7} ${s * 0.4}c${-s * 0.25} ${s * 0.3} ${-s * 0.55} 0 ${-s * 0.3} ${-s * 0.2}`;
  return <path d={d} fill="none" stroke={G(600)} strokeWidth={0.02} strokeLinecap="round" transform={`rotate(${ang} ${x} ${y})`} />;
}

const SPRITES: Record<string, (r: number) => ReactNode> = {
  tomato: (r) => (
    <>
      {spokes(6, r).map((a) => <Pinnate key={a} ang={a} len={0.98} fill={G(600)} pairs={3} lf={[0.3, 0.17]} ribC={G(700)} />)}
      {spokes(4, r + 45).map((a) => <Pinnate key={a} ang={a} len={0.55} fill={G(500)} pairs={2} lf={[0.22, 0.13]} />)}
      <g transform="translate(0 .03)">
        <path d="M0 -.2C.13 -.3 .34 -.25 .34 -.02C.34 .21 .17 .29 0 .29C-.17 .29 -.34 .21 -.34 -.02C-.34 -.25 -.13 -.3 0 -.2Z" fill={C.red} {...EDGE} />
        <path d="M-.05 -.16Q0 -.02 .05 -.16" fill="none" stroke="oklch(0.5 0.15 30)" strokeWidth={0.02} strokeLinecap="round" />
        <ellipse cx={-0.15} cy={-0.06} rx={0.06} ry={0.09} fill="white" opacity={0.35} transform="rotate(-25 -.15 -.06)" />
        <path d="M0 -.21L-.17 -.25L-.06 -.19L-.12 -.1L0 -.17L.12 -.1L.06 -.19L.17 -.25Z" fill={G(600)} stroke={G(600)} strokeWidth={0.02} strokeLinejoin="round" />
        <path d="M0 -.21Q.01 -.29 .05 -.32" fill="none" stroke={G(700)} strokeWidth={0.04} strokeLinecap="round" />
      </g>
    </>
  ),
  kale: (r) => (
    <>
      {spokes(7, r).map((a) => <Leaf key={a} shape="ruffle" ang={a} len={1} wid={0.36} fill={C.glauc} rib={C.glaucL} />)}
      {spokes(4, r + 25).map((a) => <Leaf key={a} shape="ruffle" ang={a} len={0.55} wid={0.3} fill={C.glaucD} rib={C.glaucL} />)}
    </>
  ),
  carrot: (r) => (
    <>
      {spokes(6, r).map((a) => <Feather key={a} ang={a} len={1} fill={G(500)} n={5} w={0.05} />)}
      {spokes(5, r + 30).map((a) => <Feather key={a} ang={a} len={0.65} fill={G(400)} n={3} w={0.045} />)}
      <Dot x={0} y={0} r={0.17} fill={C.orange} />
    </>
  ),
  onion: (r) => (
    <>
      {spokes(4, r).map((a) => <Leaf key={a} shape="strap" ang={a} len={1} wid={0.14} fill={G(500)} rib={G(400)} ribW={0.02} />)}
      <Dot x={0} y={0} r={0.22} fill={C.white} edge={{ stroke: 'var(--color-neutral-500)', strokeWidth: 0.03 }} />
    </>
  ),
  bean: (r) => (
    <>
      {spokes(5, r).map((a) => <Trifoliate key={a} ang={a} len={0.9} fill={G(500)} lf={[0.42, 0.34]} />)}
      {spokes(3, r + 36).map((a) => <Tendril key={a} ang={a} dist={0.5} s={0.3} />)}
      {spokes(2, r + 36).map((a) => {
        const [x, y] = polar(a, 0.25);
        return <Flower key={a} x={x} y={y} s={0.07} petal={C.white} center={G(300)} />;
      })}
    </>
  ),
  lettuce: (r) => (
    <>
      {spokes(8, r).map((a) => <Leaf key={a} shape="ruffle" ang={a} len={0.98} wid={0.6} fill={G(300)} />)}
      {spokes(5, r + 20).map((a) => <Leaf key={a} shape="ruffle" ang={a} len={0.62} wid={0.5} fill={G(400)} />)}
      {spokes(3, r).map((a) => <Leaf key={a} shape="obovate" ang={a} len={0.3} wid={0.26} fill={G(500)} />)}
    </>
  ),
  squash: (r) => (
    <>
      {spokes(5, r).map((a) => <Leaf key={a} shape="lobed" ang={a} len={0.98} wid={0.62} fill={G(500)} />)}
      <g>
        <Dot x={0} y={0} r={0.3} fill={C.pump} edge={EDGE} />
        <path d="M-.3 0Q0 -.16 .3 0M-.3 0Q0 .16 .3 0M0 -.3Q-.14 0 0 .3M0 -.3Q.14 0 0 .3" fill="none" stroke="oklch(0.55 0.13 50)" strokeWidth={0.022} />
        <Dot x={0} y={0} r={0.055} fill={G(800)} />
      </g>
    </>
  ),
  basil: (r) => (
    <>
      {spokes(4, r).map((a) => <Leaf key={a} shape="basil" ang={a} len={0.96} wid={0.58} fill={G(400)} rib={G(200)} sideVeins={3} />)}
      {spokes(4, r + 45).map((a) => <Leaf key={a} shape="basil" ang={a} len={0.62} wid={0.42} fill={G(500)} rib={G(300)} sideVeins={2} />)}
      {spokes(2, r + 90).map((a) => <Leaf key={a} shape="basil" ang={a} len={0.3} wid={0.22} fill={G(500)} rib={G(300)} />)}
    </>
  ),
};

/** Sprites are keyed by the sprite library's names; a crop id maps through here when they differ. */
const SPRITE_KEY: Record<string, string> = { beans: 'bean' };

export function PlantSprite({
  cropId,
  diameter,
  rotation = 0,
  fallbackColor = 'var(--color-accent)',
}: {
  cropId: string;
  diameter: number;
  /** Degrees; turns the whole rosette so repeated plants don't look stamped. */
  rotation?: number;
  /** The flat disc drawn for a crop that has no sprite yet. */
  fallbackColor?: string;
}) {
  const draw = SPRITES[SPRITE_KEY[cropId] ?? cropId];
  return (
    <svg
      width={diameter}
      height={diameter}
      viewBox="-1.05 -1.05 2.1 2.1"
      style={{ display: 'block', flex: 'none', overflow: 'visible', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <circle r={0.9} fill="var(--color-accent-2-900)" opacity={0.1} />
      {draw ? draw(rotation) : <circle r={0.7} fill={fallbackColor} />}
    </svg>
  );
}
