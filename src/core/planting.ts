import type { Point } from '../types';
import { isInsideOutline, type Outline } from './geometry';

// The rules of the planting view's gestures: where a brush stroke puts
// plants, what a click selects, and how a stamp repeats a set of plants. All pure, so they run in
// Node. Hit testing and selection work in garden space (one frame for every bed); a stroke works
// in the frame of the bed it started in.

/** A plant as a gesture sees it: a circle (its spacing ring) in one frame, in one patch. */
export interface Disc {
  id: string;
  x: number;
  y: number;
  /** Half the crop's spacing, in inches. */
  r: number;
  groupId: string;
}

/**
 * Two plants sit "in the same spot" once their centers are closer than this fraction of the sum
 * of their radii. Looser than the spacing the warnings want (so a brush can still pack a patch
 * edge to edge), tight enough that a stroke never stacks one plant on another.
 */
export const OCCUPIED_FACTOR = 0.85;

/** Whether a plant of radius `r` at `p` would sit on top of one of `discs`. */
export function isOccupied(p: Point, r: number, discs: Pick<Disc, 'x' | 'y' | 'r'>[]): boolean {
  return discs.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < (r + d.r) * OCCUPIED_FACTOR);
}

/** Whether a plant of radius `r` can go at `p` in a bed: its center inside `outline`, not on another plant. */
export function canPlantAt(p: Point, r: number, outline: Outline, existing: Pick<Disc, 'x' | 'y' | 'r'>[]): boolean {
  return isInsideOutline(p, outline) && !isOccupied(p, r, existing);
}

/**
 * The spots a brush stroke has covered once it reaches `to`: `spots` so far, plus each grid node
 * between `from` and `to` that is inside the bed and not on a plant (an existing one or one
 * painted already). The exception is the node the stroke began on (`anchor`): the gardener
 * pressed exactly there, so it is planted even if it is crowded — the spacing warnings then say
 * so — rather than the press doing nothing.
 */
export function extendStroke(
  spots: Point[],
  anchor: Point,
  from: Point,
  to: Point,
  r: number,
  outline: Outline,
  existing: Pick<Disc, 'x' | 'y' | 'r'>[],
): Point[] {
  const next = [...spots];
  const painted = next.map((s) => ({ x: s.x, y: s.y, r }));
  for (const s of brushSpots(anchor, from, to, r * 2)) {
    const first = s.x === anchor.x && s.y === anchor.y && next.length === 0;
    const ok = first ? isInsideOutline(s, outline) : canPlantAt(s, r, outline, [...existing, ...painted]);
    if (!ok) continue;
    next.push(s);
    painted.push({ x: s.x, y: s.y, r });
  }
  return next;
}

/** The grid of spacing `spacing` that passes through `anchor`, and the node of it nearest `p`. */
export function snapToGrid(p: Point, anchor: Point, spacing: number): Point {
  return {
    x: anchor.x + Math.round((p.x - anchor.x) / spacing) * spacing,
    y: anchor.y + Math.round((p.y - anchor.y) / spacing) * spacing,
  };
}

/**
 * The grid nodes a brush crosses moving from `from` to `to` (both ends included), nearest the start first. The grid
 * is `spacing` apart and passes through `anchor` (where the stroke began), so plants painted
 * along any path stay in neat rows. Nodes are sampled twice per spacing along the segment, so a
 * fast sweep leaves no gaps; the same node is never listed twice.
 */
export function brushSpots(anchor: Point, from: Point, to: Point, spacing: number): Point[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (spacing / 2)));
  const out: Point[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= steps; i++) {
    const q = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    const node = snapToGrid(q, anchor, spacing);
    const key = `${Math.round(node.x * 1000)},${Math.round(node.y * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(node);
  }
  return out;
}

/**
 * The topmost plant under `p` (later ones draw on top), else — so a patch can be grabbed by the
 * ground between its plants — the nearest member of a patch of two or more whose ring `p` is
 * inside. `zoom` is screen pixels per inch: a plant is always at least 6 px to hit, whatever its size.
 */
export function hitPlant(discs: Disc[], p: Point, zoom: number): Disc | null {
  for (let i = discs.length - 1; i >= 0; i--) {
    const d = discs[i];
    if (Math.hypot(d.x - p.x, d.y - p.y) < Math.max(d.r * 0.9, 6 / zoom)) return d;
  }
  const size = new Map<string, number>();
  for (const d of discs) size.set(d.groupId, (size.get(d.groupId) ?? 0) + 1);
  let best: Disc | null = null;
  let bestDist = Infinity;
  for (const d of discs) {
    if ((size.get(d.groupId) ?? 0) < 2) continue;
    const dist = Math.hypot(d.x - p.x, d.y - p.y);
    if (dist < d.r + 2 + 1.5 / zoom && dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

export interface ClickModifiers {
  /** ⌘ or Ctrl: toggle this one plant. */
  toggle: boolean;
  /** Shift: toggle this plant's whole patch. */
  shift: boolean;
}

export interface ClickSelection {
  selection: string[];
  /** If the press turns out to be a click (no drag), narrow the selection to this one plant. */
  drill: string | null;
}

const uniq = (ids: string[]) => [...new Set(ids)];

/**
 * What pressing on `hit` selects. A plain press picks its whole patch; pressing again on a
 * plant of the selected patch means "just this one" — which only takes effect on release, so
 * that dragging the selected patch still moves all of it. ⌘/Ctrl toggles one plant, shift a patch.
 */
export function selectOnPress(discs: Disc[], hit: Disc, current: string[], mods: ClickModifiers): ClickSelection {
  const patch = discs.filter((d) => d.groupId === hit.groupId).map((d) => d.id);
  const whole = patch.every((id) => current.includes(id));
  if (mods.toggle) {
    return { selection: current.includes(hit.id) ? current.filter((id) => id !== hit.id) : [...current, hit.id], drill: null };
  }
  if (mods.shift) {
    return { selection: whole ? current.filter((id) => !patch.includes(id)) : uniq([...current, ...patch]), drill: null };
  }
  if (!current.includes(hit.id)) return { selection: patch, drill: null };
  if (whole && patch.length > 1 && current.length === patch.length) return { selection: current, drill: hit.id };
  return { selection: current, drill: null };
}

/** The plants whose centers lie in the rectangle between corners `a` and `b`, after `base`. */
export function marqueeSelect(discs: Disc[], a: Point, b: Point, base: string[] = []): string[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return uniq([...base, ...discs.filter((d) => d.x >= x0 && d.x <= x1 && d.y >= y0 && d.y <= y1).map((d) => d.id)]);
}

/** A plant in a stamp: what it is, and where it sits relative to the middle of the set it was taken from. */
export interface StampItem {
  cropId: string;
  dx: number;
  dy: number;
  /** Items with the same key were one patch, and come out as one patch. */
  group: string;
}

/** The middle of a set of points. */
export function centroid(points: Point[]): Point {
  const n = points.length || 1;
  return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
}

/** Records plants (with their garden positions) as a stamp. Empty for no plants. */
export function stampOf(plants: { cropId: string; x: number; y: number; groupId: string }[]): StampItem[] {
  if (plants.length === 0) return [];
  const c = centroid(plants);
  return plants.map((p) => ({ cropId: p.cropId, dx: p.x - c.x, dy: p.y - c.y, group: p.groupId }));
}

/** Where each item of a stamp lands with the stamp's middle at `at`. */
export function stampSpots(stamp: StampItem[], at: Point): (Point & { item: StampItem })[] {
  return stamp.map((item) => ({ x: at.x + item.dx, y: at.y + item.dy, item }));
}

/** The smallest rectangle holding the rings of these plants, or null for none. */
export function extent(discs: Disc[]): { x0: number; y0: number; x1: number; y1: number } | null {
  if (discs.length === 0) return null;
  return {
    x0: Math.min(...discs.map((d) => d.x - d.r)),
    y0: Math.min(...discs.map((d) => d.y - d.r)),
    x1: Math.max(...discs.map((d) => d.x + d.r)),
    y1: Math.max(...discs.map((d) => d.y + d.r)),
  };
}
