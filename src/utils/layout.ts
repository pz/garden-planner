import type { Bed, PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { isInsideOutline, type Outline, type Point } from './geometry';

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

/** Just enough of a bed to place it: center, size and turn. */
export type BedPlacement = Pick<Bed, 'cx' | 'cy' | 'widthIn' | 'heightIn' | 'rotationDeg'>;

/** Where and how big a bed is (and a polygon's corners), without its identity or name. */
export type BedGeometry = Pick<Bed, 'cx' | 'cy' | 'widthIn' | 'heightIn' | 'points'>;

/** The geometry fields of a bed, e.g. to hand a drafted resize to the reducer. */
export function geometryOf(bed: Bed): BedGeometry {
  const g: BedGeometry = { cx: bed.cx, cy: bed.cy, widthIn: bed.widthIn, heightIn: bed.heightIn };
  if (bed.points) g.points = bed.points;
  return g;
}

/** The region of a bed that plant centers must stay inside, in its local frame. */
export function bedOutline(bed: Bed): Outline {
  if (bed.shape === 'ellipse') return { shape: 'ellipse', widthIn: bed.widthIn, heightIn: bed.heightIn };
  if (bed.shape === 'polygon' && bed.points) {
    return { shape: 'polygon', widthIn: bed.widthIn, heightIn: bed.heightIn, points: bed.points };
  }
  return { shape: 'rect', widthIn: bed.widthIn, heightIn: bed.heightIn, cornerRadiusIn: BED_CORNER_RADIUS_IN };
}

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
function normalizeCorners(pts: Point[]): { points: Point[]; widthIn: number; heightIn: number; center: Point } | null {
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

/**
 * The polygon bed with corner `index` dragged to the garden point `pointer`, snapped to the
 * grid measured from the bed's top-left. The box re-fits the corners, and the other corners
 * stay where they are in the garden. The bed comes back unchanged if the move would collapse
 * it (a box under the minimum side, or no area).
 */
export function moveCorner(bed: Bed, index: number, pointer: Point): Bed {
  if (!bed.points || index < 0 || index >= bed.points.length) return bed;
  const local = gardenToBed(bed, pointer);
  const moved = bed.points.map((q, i) => (i === index ? { x: snapTo(local.x), y: snapTo(local.y) } : q));
  const n = normalizeCorners(moved);
  if (!n) return bed;
  const center = bedToGarden(bed, n.center);
  return { ...bed, cx: center.x, cy: center.y, widthIn: n.widthIn, heightIn: n.heightIn, points: n.points };
}

/** How close (in screen pixels) a click must land to a polygon's first corner to close it. */
export const CLOSE_POLYGON_PX = 14;

/**
 * Whether a click at `cursor` (snapped) should close an in-progress polygon: it's back on the
 * first corner — within a comfortable target on screen at this zoom, and never less than one
 * snap step, so a snapped click on the corner always counts.
 */
export function closesPolygon(corners: Point[], cursor: Point, zoom: number): boolean {
  const toleranceIn = Math.max(LAYOUT_SNAP_IN, CLOSE_POLYGON_PX / zoom);
  return corners.length >= 3 && Math.hypot(cursor.x - corners[0].x, cursor.y - corners[0].y) <= toleranceIn;
}

export interface EdgeLabel {
  /** Midpoint of the edge. */
  mid: Point;
  /** Unit vector pointing away from the shape's inside, for placing the label clear of it. */
  outward: Point;
  lengthIn: number;
}

/**
 * Length label anchors for each edge of a closed polygon (`closed: false` for an open chain
 * being drawn, which leaves out the closing edge). Zero-length edges are skipped.
 */
export function edgeLabels(corners: Point[], closed = true): EdgeLabel[] {
  // Clockwise on screen (positive signed area) → the outside is to the left of each edge.
  const sign = signedArea2(corners) >= 0 ? 1 : -1;
  const labels: EdgeLabel[] = [];
  const n = closed ? corners.length : corners.length - 1;
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    labels.push({
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      outward: { x: (sign * dy) / len, y: (-sign * dx) / len },
      lengthIn: len,
    });
  }
  return labels;
}

/**
 * How far out along an edge's `outward` normal to center a `halfW` × `halfH` label so it clears
 * the edge by `gap`: further for a label sitting across its edge than for one alongside it.
 */
export function labelOffset(outward: Point, halfW: number, halfH: number, gap: number): number {
  return gap + Math.abs(outward.x) * halfW + Math.abs(outward.y) * halfH;
}

/** Beds turn in steps of this many degrees, by handle, buttons or typed angle. */
export const ROTATION_STEP_DEG = 45;

/** An angle in degrees brought into 0…360 (never -0 or 360). */
export function normalizeAngle(deg: number): number {
  return (((deg % 360) + 360) % 360) + 0;
}

/** An angle rounded to the nearest rotation step, normalized. Half-way rounds up. */
export function snapAngle(deg: number, step = ROTATION_STEP_DEG): number {
  return normalizeAngle(Math.round(deg / step) * step);
}

/**
 * The bed's rotation when its rotate handle (which sits above the top edge when unturned) is
 * dragged to the garden point `pointer`, snapped to the rotation step.
 */
export function rotationFromPointer(bed: Pick<Bed, 'cx' | 'cy'>, pointer: Point): number {
  const deg = (Math.atan2(pointer.y - bed.cy, pointer.x - bed.cx) * 180) / Math.PI + 90;
  return snapAngle(deg);
}

/** Reads a typed angle like "90", "90°" or "-45 deg". Null for anything else. */
export function parseAngle(text: string): number | null {
  const m = text.trim().toLowerCase().match(/^(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees?)?$/);
  return m ? +m[1] : null;
}

/**
 * The resize cursor for dragging `handle` on a bed turned by `rotationDeg`: the handle's
 * direction, turned with the bed, to the nearest of the four double-arrow cursors.
 */
export function resizeCursor(handle: Handle, rotationDeg: number): string {
  const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
  const deg = (Math.atan2(handle.sy, handle.sx) * 180) / Math.PI + rotationDeg;
  const half = (((deg % 180) + 180) % 180);
  return cursors[Math.round(half / 45) % 4];
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
