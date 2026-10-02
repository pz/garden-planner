import type { Bed, PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { isInsideBed, type Point } from './geometry';

/** Bed edges and sizes snap to this step, in inches. */
export const LAYOUT_SNAP_IN = 6;
/** No bed side may be shorter than this, in inches. */
export const MIN_BED_SIDE_IN = 12;
/** Beds are drawn with rounded corners; plant centers must stay inside the curve. */
export const BED_CORNER_RADIUS_IN = 3.5;
/** The planting view's fixed scale, and the layout editor's 100% zoom. */
export const PLANTING_PX_PER_INCH = 7;

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 16;

/** Where and how big a bed is, without its identity or name. */
export type BedGeometry = Pick<Bed, 'cx' | 'cy' | 'widthIn' | 'heightIn'>;

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function snapTo(v: number, step = LAYOUT_SNAP_IN): number {
  // `+ 0` folds -0 into 0 so snapped values compare and serialize cleanly.
  return Math.round(v / step) * step + 0;
}

function rotate(p: Point, deg: number): Point {
  if (deg === 0) return p;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** A point in a bed's local frame (inches from its unrotated top-left) to garden coordinates. */
export function bedToGarden(bed: Bed, local: Point): Point {
  const q = rotate({ x: local.x - bed.widthIn / 2, y: local.y - bed.heightIn / 2 }, bed.rotationDeg);
  return { x: bed.cx + q.x, y: bed.cy + q.y };
}

/** Inverse of bedToGarden. */
export function gardenToBed(bed: Bed, p: Point): Point {
  const q = rotate({ x: p.x - bed.cx, y: p.y - bed.cy }, -bed.rotationDeg);
  return { x: q.x + bed.widthIn / 2, y: q.y + bed.heightIn / 2 };
}

/** Axis-aligned box around a bed's four corners, in garden coordinates. */
export function bedBounds(bed: Bed): Bounds {
  const corners = [
    { x: 0, y: 0 },
    { x: bed.widthIn, y: 0 },
    { x: bed.widthIn, y: bed.heightIn },
    { x: 0, y: bed.heightIn },
  ].map((c) => bedToGarden(bed, c));
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

/** The axis-aligned box spanned by two points, whichever way round they are. */
export function boxBetween(a: Point, b: Point): { x: number; y: number; width: number; height: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Corner radius to draw a bed with: the usual rounding, but never more than a quarter of a side. */
export function drawnCornerRadius(bed: Pick<Bed, 'widthIn' | 'heightIn'>): number {
  return Math.min(BED_CORNER_RADIUS_IN, bed.widthIn / 4, bed.heightIn / 4);
}

/** The bed geometry for a rectangle dragged out between two points, or null if it's too small. */
export function rectFromCorners(a: Point, b: Point): BedGeometry | null {
  const x0 = snapTo(Math.min(a.x, b.x));
  const x1 = snapTo(Math.max(a.x, b.x));
  const y0 = snapTo(Math.min(a.y, b.y));
  const y1 = snapTo(Math.max(a.y, b.y));
  if (x1 - x0 < MIN_BED_SIDE_IN || y1 - y0 < MIN_BED_SIDE_IN) return null;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, widthIn: x1 - x0, heightIn: y1 - y0 };
}

/** A typed or stepped side length as a bed can take it: on the snap grid and at least the minimum. */
export function normalizeSide(inches: number): number {
  return Math.max(MIN_BED_SIDE_IN, snapTo(inches));
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
 * dragging the right edge grows the bed rightward, never around its center. Sizes are taken
 * as given; see resizeFromPointer for snapping and the minimum.
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
  return { ...bed, cx: center.x, cy: center.y, widthIn, heightIn };
}

/**
 * The bed resized by dragging `handle` to the garden point `pointer`: each side the handle
 * moves lands on the snap grid (relative to the fixed opposite side) and never shrinks below
 * MIN_BED_SIDE_IN, even if the pointer crosses over to the other side.
 */
export function resizeFromPointer(bed: Bed, handle: Handle, pointer: Point): Bed {
  const local = gardenToBed(bed, pointer);
  const width =
    handle.sx === 0
      ? bed.widthIn
      : Math.max(MIN_BED_SIDE_IN, snapTo(handle.sx === 1 ? local.x : bed.widthIn - local.x));
  const height =
    handle.sy === 0
      ? bed.heightIn
      : Math.max(MIN_BED_SIDE_IN, snapTo(handle.sy === 1 ? local.y : bed.heightIn - local.y));
  return resizeBedTo(bed, width, height, handle);
}

/**
 * Re-expresses a bed's plants in `next`'s local frame so they keep their place in the garden
 * when the bed is resized (they don't stretch or slide with the edges). `outsideIds` are the
 * plants whose centers `next` no longer contains. Other beds' plants pass through untouched.
 */
export function relocatePlants(
  prev: Bed,
  next: Bed,
  plants: PlantInstance[],
): { plants: PlantInstance[]; outsideIds: string[] } {
  const outsideIds: string[] = [];
  const moved = plants.map((p) => {
    if (p.bedId !== prev.id) return p;
    const local = gardenToBed(next, bedToGarden(prev, p));
    if (!isInsideBed(local, next.widthIn, next.heightIn, BED_CORNER_RADIUS_IN)) outsideIds.push(p.id);
    return { ...p, x: local.x, y: local.y };
  });
  return { plants: moved, outsideIds };
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

/** 54 → "4′ 6″", 48 → "4′", 6 → "6″". Rounds to the nearest inch. */
export function formatLength(inches: number): string {
  const total = Math.round(inches);
  const ft = Math.floor(total / 12);
  const inch = total % 12;
  if (ft === 0) return `${inch}″`;
  return inch === 0 ? `${ft}′` : `${ft}′ ${inch}″`;
}

/**
 * Reads a typed length as inches: "4′ 6″", "4' 6\"", "4ft 6in", "4 6" (feet then inches),
 * "54in", "54″", or a bare number, which means feet. Returns null for anything else, or a
 * length that isn't positive.
 */
export function parseLength(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  const n = '(\\d+(?:\\.\\d+)?)';
  const patterns: [RegExp, (m: RegExpMatchArray) => number][] = [
    [new RegExp(`^${n}\\s*(?:'|ft|feet|foot)\\s*(?:${n}\\s*(?:"|in|inch|inches)?)?$`), (m) => +m[1] * 12 + (m[2] ? +m[2] : 0)],
    [new RegExp(`^${n}\\s*(?:"|in|inch|inches)$`), (m) => +m[1]],
    [new RegExp(`^${n}\\s+${n}$`), (m) => +m[1] * 12 + +m[2]],
    [new RegExp(`^${n}$`), (m) => +m[1] * 12],
  ];
  for (const [re, toInches] of patterns) {
    const m = t.match(re);
    if (m) {
      const v = toInches(m);
      return v > 0 ? v : null;
    }
  }
  return null;
}

/**
 * The editor's camera: `zoom` screen pixels per inch, and (x, y) the garden point at the
 * viewport's top-left corner.
 */
export interface View {
  zoom: number;
  x: number;
  y: number;
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Garden point under screen offset (sx, sy) from the viewport's top-left. */
export function screenToGarden(view: View, sx: number, sy: number): Point {
  return { x: view.x + sx / view.zoom, y: view.y + sy / view.zoom };
}

/** Zooms by `factor`, keeping the garden point under screen offset (sx, sy) where it is. */
export function zoomAt(view: View, sx: number, sy: number, factor: number): View {
  const zoom = clampZoom(view.zoom * factor);
  const p = screenToGarden(view, sx, sy);
  return { zoom, x: p.x - sx / zoom, y: p.y - sy / zoom };
}

/** Pans by a screen-pixel delta (dragging content right moves the camera left). */
export function panBy(view: View, dxPx: number, dyPx: number): View {
  return { ...view, x: view.x - dxPx / view.zoom, y: view.y - dyPx / view.zoom };
}

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The view that centers `bounds` in the part of a `width` × `height` viewport left clear by
 * `insets` (room for overlaid toolbars and panels), as large as fits. An empty garden frames
 * a default 8′ × 4′ patch of ground at the origin.
 */
export function fitView(bounds: Bounds | null, width: number, height: number, insets: Insets): View {
  const b = bounds ?? { x0: 0, y0: 0, x1: 96, y1: 48 };
  const availW = Math.max(120, width - insets.left - insets.right);
  const availH = Math.max(120, height - insets.top - insets.bottom);
  const zoom = clampZoom(Math.min(availW / Math.max(12, b.x1 - b.x0), availH / Math.max(12, b.y1 - b.y0)));
  return {
    zoom,
    x: (b.x0 + b.x1) / 2 - (insets.left + availW / 2) / zoom,
    y: (b.y0 + b.y1) / 2 - (insets.top + availH / 2) / zoom,
  };
}

/** A press that travels further than this many screen pixels is a drag, not a click. */
export const CLICK_SLOP_PX = 3;

export function isDrag(dxPx: number, dyPx: number): boolean {
  return Math.hypot(dxPx, dyPx) > CLICK_SLOP_PX;
}

/**
 * Largest wheel delta one event may zoom by. Trackpad pinches send small deltas and are
 * unaffected; a mouse wheel sends ~100 per notch, which would otherwise zoom ~2.7× per click.
 */
export const MAX_WHEEL_ZOOM_DELTA = 25;

/** Zoom factor for one wheel/pinch event: smooth, and symmetric so in-then-out returns to start. */
export function wheelZoomFactor(deltaY: number): number {
  const d = Math.max(-MAX_WHEEL_ZOOM_DELTA, Math.min(MAX_WHEEL_ZOOM_DELTA, deltaY));
  return Math.exp(-d * 0.01);
}

/** Zoom as a percentage of the planting view's scale. */
export function zoomPercent(view: View): number {
  return Math.round((view.zoom / PLANTING_PX_PER_INCH) * 100);
}
