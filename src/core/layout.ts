import type { Bed, PlantInstance } from '../types';
import { isInsideOutline, type Outline, type Point } from './geometry';
import { getCrop } from '../data/crops';

/** No bed side may be shorter than this, in inches. */
export const MIN_BED_SIDE_IN = 12;
/** Rectangular beds are square-cornered unless given a radius; plant centers stay inside any curve. */
export const BED_CORNER_RADIUS_IN = 0;
/** Just enough of a bed to place it: center, size and turn. */
export type BedPlacement = Pick<Bed, 'cx' | 'cy' | 'widthIn' | 'heightIn' | 'rotationDeg'>;
/** Where and how big a bed is (and a polygon's corners), without its identity or name. */
export type BedGeometry = Pick<Bed, 'cx' | 'cy' | 'widthIn' | 'heightIn' | 'points' | 'cornerRadiusIn'>;
/** The geometry fields of a bed, e.g. to hand a drafted resize to the reducer. */
export function geometryOf(bed: Bed): BedGeometry {
  const g: BedGeometry = { cx: bed.cx, cy: bed.cy, widthIn: bed.widthIn, heightIn: bed.heightIn };
  if (bed.points) g.points = bed.points;
  if (bed.cornerRadiusIn !== undefined) g.cornerRadiusIn = bed.cornerRadiusIn;
  return g;
}
/** The region of a bed that plant centers must stay inside, in its local frame. */
export function bedOutline(bed: Bed): Outline {
  if (bed.shape === 'ellipse') return { shape: 'ellipse', widthIn: bed.widthIn, heightIn: bed.heightIn };
  if (bed.shape === 'polygon' && bed.points) {
    return { shape: 'polygon', widthIn: bed.widthIn, heightIn: bed.heightIn, points: bed.points };
  }
  return { shape: 'rect', widthIn: bed.widthIn, heightIn: bed.heightIn, cornerRadiusIn: drawnCornerRadius(bed) };
}
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export function rotate(p: Point, deg: number): Point {
  if (deg === 0) return p;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
/** A point in a bed's local frame (inches from its unrotated top-left) to garden coordinates. */
export function bedToGarden(bed: BedPlacement, local: Point): Point {
  const q = rotate({ x: local.x - bed.widthIn / 2, y: local.y - bed.heightIn / 2 }, bed.rotationDeg);
  return { x: bed.cx + q.x, y: bed.cy + q.y };
}
/** Inverse of bedToGarden. */
export function gardenToBed(bed: BedPlacement, p: Point): Point {
  const q = rotate({ x: p.x - bed.cx, y: p.y - bed.cy }, -bed.rotationDeg);
  return { x: q.x + bed.widthIn / 2, y: q.y + bed.heightIn / 2 };
}
/** The corners of a bed's (possibly turned) box in garden coordinates: top-left, top-right, bottom-right, bottom-left. */
export function boxCorners(bed: BedPlacement): Point[] {
  return [
    { x: 0, y: 0 },
    { x: bed.widthIn, y: 0 },
    { x: bed.widthIn, y: bed.heightIn },
    { x: 0, y: bed.heightIn },
  ].map((c) => bedToGarden(bed, c));
}
/** The outline of a bed in garden coordinates: its corners, or a fine polygon around an ellipse. */
export function outlinePoints(bed: Bed): Point[] {
  if (bed.shape === 'polygon' && bed.points) return bed.points.map((q) => bedToGarden(bed, q));
  if (bed.shape === 'ellipse') {
    const n = 64; // a multiple of 4, so the extreme points of an unturned ellipse are sampled exactly
    return Array.from({ length: n }, (_, i) => {
      const t = (i / n) * 2 * Math.PI;
      return bedToGarden(bed, {
        x: bed.widthIn / 2 + (bed.widthIn / 2) * Math.cos(t),
        y: bed.heightIn / 2 + (bed.heightIn / 2) * Math.sin(t),
      });
    });
  }
  return boxCorners(bed);
}
/** Axis-aligned box around a bed's four corners, in garden coordinates. */
export function bedBounds(bed: BedPlacement): Bounds {
  const corners = boxCorners(bed);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
/** Box around every bed, or null for a garden with no beds. */
export function gardenBounds(beds: Bed[]): Bounds | null {
  if (beds.length === 0) return null;
  const all = beds.map(bedBounds);
  return {
    x0: Math.min(...all.map((b) => b.x0)),
    y0: Math.min(...all.map((b) => b.y0)),
    x1: Math.max(...all.map((b) => b.x1)),
    y1: Math.max(...all.map((b) => b.y1)),
  };
}
/** The most a rectangle's corners can be rounded: half its shorter side (a pill or circle). */
export function maxCornerRadius(bed: Pick<Bed, 'widthIn' | 'heightIn'>): number {
  return Math.min(bed.widthIn, bed.heightIn) / 2;
}
/**
 * Corner radius a rectangular bed is drawn with, and its plants kept inside: its own setting
 * (or the default), but never more than the bed can curve.
 */
export function drawnCornerRadius(bed: Pick<Bed, 'widthIn' | 'heightIn' | 'cornerRadiusIn'>): number {
  return Math.min(bed.cornerRadiusIn ?? BED_CORNER_RADIUS_IN, maxCornerRadius(bed));
}
/** A typed or stepped corner radius as a bed can take it: whole inches, from square up to the most it can curve. */
export function normalizeCornerRadius(inches: number, bed: Pick<Bed, 'widthIn' | 'heightIn'>): number {
  return Math.min(Math.floor(maxCornerRadius(bed)), Math.max(0, Math.round(inches)));
}
/** A typed or stepped side length as a bed can take it: whole inches, and at least the minimum. */
export function normalizeSide(inches: number): number {
  return Math.max(MIN_BED_SIDE_IN, Math.round(inches));
}
/**
 * Which edge or corner is being dragged: -1/+1 for the left/right (or top/bottom) side, 0 for
 * an axis the handle doesn't change. {sx: 1, sy: 0} is the right edge; {sx: -1, sy: 1} is the
 * bottom-left corner.
 */
export interface Handle {
  sx: -1 | 0 | 1;
  sy: -1 | 0 | 1;
}
/**
 * The bed resized to `widthIn` × `heightIn` with the side opposite `handle` held in place —
 * dragging the right edge grows the bed rightward, never around its center. A polygon's corners
 * scale with it. Sizes are taken as given; see resizeFromPointer for snapping and the minimum.
 */
export function resizeBedTo(bed: Bed, widthIn: number, heightIn: number, handle: Handle): Bed {
  // Along an axis the handle moves, the opposite side (local 0 or the old size) stays put and
  // the new center sits half the new size away from it; along an axis it doesn't, the center
  // stays where it was.
  const axisCenter = (s: -1 | 0 | 1, oldSize: number, newSize: number) =>
    s === 0 ? oldSize / 2 : ((1 - s) * oldSize) / 2 + (s * newSize) / 2;
  const center = bedToGarden(bed, {
    x: axisCenter(handle.sx, bed.widthIn, widthIn),
    y: axisCenter(handle.sy, bed.heightIn, heightIn),
  });
  const next: Bed = { ...bed, cx: center.x, cy: center.y, widthIn, heightIn };
  // A polygon stretches with its box, so its corners keep their place relative to the edges.
  if (bed.points) {
    next.points = bed.points.map((q) => ({ x: (q.x * widthIn) / bed.widthIn, y: (q.y * heightIn) / bed.heightIn }));
  }
  return next;
}
/**
 * Re-expresses a bed's plants in `next`'s local frame so they keep their place in the garden
 * when the bed is resized or reshaped (they don't stretch or slide with the edges). `outsideIds` are the
 * plants whose centers `next` no longer contains. Other beds' plants pass through untouched.
 */
export function relocatePlants(
  prev: Bed,
  next: Bed,
  plants: PlantInstance[],
): { plants: PlantInstance[]; outsideIds: string[] } {
  const outsideIds: string[] = [];
  const outline = bedOutline(next);
  const moved = plants.map((p) => {
    if (p.bedId !== prev.id) return p;
    const local = gardenToBed(next, bedToGarden(prev, p));
    if (!isInsideOutline(local, outline)) outsideIds.push(p.id);
    return { ...p, x: local.x, y: local.y };
  });
  return { plants: moved, outsideIds };
}
/** Twice the signed area of a polygon: positive when its corners run clockwise on screen (y down). */
export function signedArea2(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}
/**
 * Corners re-expressed so their bounding box starts at (0, 0), with the box's size and its
 * center in the corners' original frame. Null if the box is under the minimum side on either
 * axis or the corners enclose no area (all in a line).
 */
export function normalizeCorners(pts: Point[]): { points: Point[]; widthIn: number; heightIn: number; center: Point } | null {
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const widthIn = Math.max(...xs) - x0;
  const heightIn = Math.max(...ys) - y0;
  if (widthIn < MIN_BED_SIDE_IN || heightIn < MIN_BED_SIDE_IN || signedArea2(pts) === 0) return null;
  return {
    points: pts.map((p) => ({ x: p.x - x0, y: p.y - y0 })),
    widthIn,
    heightIn,
    center: { x: x0 + widthIn / 2, y: y0 + heightIn / 2 },
  };
}
/**
 * The geometry of a new polygon bed from corners clicked in the garden (already snapped), or
 * null if they don't make a usable bed: fewer than three corners, a box under the minimum
 * side, or no enclosed area.
 */
export function polygonFromCorners(corners: Point[]): Required<Pick<BedGeometry, 'points'>> & BedGeometry | null {
  const n = normalizeCorners(corners);
  if (!n) return null;
  return { cx: n.center.x, cy: n.center.y, widthIn: n.widthIn, heightIn: n.heightIn, points: n.points };
}
/** The turn buttons step to multiples of this many degrees. */
export const ROTATION_STEP_DEG = 45;
/** An angle in degrees brought into 0…360 (never -0 or 360). */
export function normalizeAngle(deg: number): number {
  return (((deg % 360) + 360) % 360) + 0;
}
/** An angle rounded to the nearest rotation step, normalized. Half-way rounds up. */
export function snapAngle(deg: number, step = ROTATION_STEP_DEG): number {
  return normalizeAngle(Math.round(deg / step) * step);
}
/** "Herbs copy", or "Herbs copy 2", "Herbs copy 3"… if that's taken. */
export function copyName(name: string, beds: Bed[]): string {
  const taken = new Set(beds.map((b) => b.name.trim().toLowerCase()));
  const base = `${name} copy`;
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}
/**
 * A copy of `bed` and its plants, shifted by `offsetIn` on both axes, ready to add to the
 * garden: new ids throughout from `makeId`, and its patches get new group ids (shared within
 * the copy, never with the original) so the copy's plants never count as part of the
 * original's patches.
 */
export function cloneBed(
  bed: Bed,
  plants: PlantInstance[],
  offsetIn: number,
  makeId: () => string,
  beds: Bed[],
): { bed: Bed; plants: PlantInstance[] } {
  const copy: Bed = { ...bed, id: makeId(), name: copyName(bed.name, beds), cx: bed.cx + offsetIn, cy: bed.cy + offsetIn };
  const groupIds = new Map<string, string>();
  const copied = plants
    .filter((p) => p.bedId === bed.id)
    .map((p) => {
      if (!groupIds.has(p.groupId)) groupIds.set(p.groupId, makeId());
      return { ...p, id: makeId(), bedId: copy.id, groupId: groupIds.get(p.groupId)! };
    });
  return { bed: copy, plants: copied };
}
/** "Tomato ×2, Basil ×1": how many of each crop, in order of first appearance. */
export function plantSummary(plants: PlantInstance[]): string {
  const counts = new Map<string, number>();
  for (const p of plants) {
    const name = getCrop(p.cropId).name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => `${name} ×${n}`).join(', ');
}
/** "Bed N" for the lowest N from the bed count upward that no existing bed is already named. */
export function nextBedName(beds: Bed[]): string {
  const taken = new Set(beds.map((b) => b.name.trim().toLowerCase()));
  let n = beds.length + 1;
  while (taken.has(`bed ${n}`)) n++;
  return `Bed ${n}`;
}