// Pure path math for the plant sprites (see components/PlantSprite.tsx). Every shape is drawn
// in a unit space: a leaf starts at the origin, points along +x and is `len` long and up to
// `wid` wide; the sprite as a whole fits a circle of radius 1.

export type LeafShape =
  | 'oval' | 'lance' | 'strap' | 'obovate' | 'paddle' | 'spade' | 'ruffle' | 'serrate' | 'ovate' | 'basil' | 'lobed' | 'deeplobed' | 'round' | 'peltate';

const f3 = (n: number) => n.toFixed(3);

/** A closed outline around (cx, 0) whose radius at angle t is R * f(t). */
export function polarPath(cx: number, R: number, f: (t: number) => number, N = 44): string {
  let d = '';
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = R * f(t);
    d += `${i ? 'L' : 'M'}${f3(cx + Math.cos(t) * r)} ${f3(Math.sin(t) * r)}`;
  }
  return `${d}Z`;
}

/** A closed outline along +x of length `len`, with half-width hw(t) at t in [0, 1]. */
export function edgePath(len: number, hw: (t: number) => number, N = 26): string {
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const w = hw(t);
    top.push(`${f3(t * len)} ${f3(-w)}`);
    bot.unshift(`${f3(t * len)} ${f3(w)}`);
  }
  return `M${top.join('L')}L${bot.join('L')}Z`;
}

export function leafPath(shape: LeafShape, len: number, w: number): string {
  switch (shape) {
    case 'oval':
      return `M0 0C${len * 0.05} ${-w * 0.7} ${len * 0.95} ${-w * 0.7} ${len} 0C${len * 0.95} ${w * 0.7} ${len * 0.05} ${w * 0.7} 0 0Z`;
    case 'lance':
      return `M0 0C${len * 0.3} ${-w * 0.6} ${len * 0.65} ${-w * 0.45} ${len} 0C${len * 0.65} ${w * 0.45} ${len * 0.3} ${w * 0.6} 0 0Z`;
    case 'paddle':
      return `M0 0C${len * 0.1} ${-w * 0.55} ${len * 0.7} ${-w * 0.7} ${len * 0.95} ${-w * 0.3}Q${len * 1.04} 0 ${len * 0.95} ${w * 0.3}C${len * 0.7} ${w * 0.7} ${len * 0.1} ${w * 0.55} 0 0Z`;
    case 'spade':
      return `M0 0Q${len * 0.12} ${-w * 0.62} ${len * 0.5} ${-w * 0.52}Q${len * 0.85} ${-w * 0.3} ${len} 0Q${len * 0.85} ${w * 0.3} ${len * 0.5} ${w * 0.52}Q${len * 0.12} ${w * 0.62} 0 0Z`;
    case 'serrate':
      return edgePath(len, (t) => (w / 2) * Math.pow(Math.sin(Math.PI * t), 0.8) * (0.7 + 0.5 * ((t * 7) % 1)) + 0.001, 42);
    case 'ovate':
      return edgePath(len, (t) => (w / 2) * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.85) * (1 + 0.07 * Math.sin(t * Math.PI * 13)) + 0.001, 40);
    case 'deeplobed':
      return polarPath(len - w / 2, w / 2, (t) => 0.3 + 0.7 * Math.pow(Math.abs(Math.cos(2.5 * t)), 0.45), 60);
    case 'round':
      return polarPath(len - w / 2, w / 2, (t) => 1 - 0.3 * Math.exp(-Math.pow(t - Math.PI, 2) / 0.04));
    case 'peltate':
      return polarPath(len - w / 2, w / 2, (t) => 0.94 + 0.06 * Math.cos(t * 7));
    case 'strap':
      return `M0 ${-w * 0.3}L${len * 0.85} ${-w * 0.5}Q${len} ${-w * 0.5} ${len} 0Q${len} ${w * 0.5} ${len * 0.85} ${w * 0.5}L0 ${w * 0.3}Z`;
    case 'obovate':
      return `M0 0C${len * 0.2} ${-w * 0.3} ${len * 0.55} ${-w * 0.75} ${len * 0.88} ${-w * 0.4}Q${len * 1.03} 0 ${len * 0.88} ${w * 0.4}C${len * 0.55} ${w * 0.75} ${len * 0.2} ${w * 0.3} 0 0Z`;
    case 'ruffle':
      return edgePath(
        len,
        (t) => (w / 2) * Math.pow(Math.sin(Math.PI * Math.min(t * 1.08, 1)), 0.65) * (1 + 0.2 * Math.sin(t * Math.PI * 11)) + 0.001,
      );
    case 'basil':
      return `M0 0C${len * 0.08} ${-w * 0.5} ${len * 0.45} ${-w * 0.72} ${len * 0.72} ${-w * 0.42}C${len * 0.88} ${-w * 0.24} ${len * 0.96} ${-w * 0.08} ${len} 0C${len * 0.96} ${w * 0.08} ${len * 0.88} ${w * 0.24} ${len * 0.72} ${w * 0.42}C${len * 0.45} ${w * 0.72} ${len * 0.08} ${w * 0.5} 0 0Z`;
    case 'lobed':
      return polarPath(len - w / 2, w / 2, (t) => 0.7 + 0.3 * Math.abs(Math.cos(2.5 * t)));
  }
}

/** The side veins of a feathery leaf (carrot tops, dill) as one stroke path. */
export function featherPath(len: number, n: number, fine = false): string {
  let d = `M0 0L${len} 0`;
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const x = t * len;
    const bl = len * 0.34 * (1 - t * 0.6);
    for (const sg of [-1, 1]) {
      const a = (sg * 42 * Math.PI) / 180;
      d += `M${x} 0l${f3(Math.cos(a) * bl)} ${f3(Math.sin(a) * bl)}`;
      if (fine) d += `M${f3(x + Math.cos(a) * bl * 0.5)} ${f3(Math.sin(a) * bl * 0.5)}l${f3(bl * 0.3)} ${f3(sg * bl * 0.05)}`;
    }
  }
  return d;
}

/** Angles (degrees) of `n` evenly spaced spokes, starting at `rot`. */
export function spokes(n: number, rot: number): number[] {
  return Array.from({ length: n }, (_, i) => rot + (i * 360) / n);
}

/** The point at `dist` from the origin along `deg`. */
export function polar(deg: number, dist: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r) * dist, Math.sin(r) * dist];
}

/** A stable 0-359 turn for a plant id, so a bed of one crop doesn't look stamped. */
export function spriteRotation(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}
