import type { Bed } from '../types';
import {
  bedBounds,
  type BedGeometry,
  bedToGarden,
  gardenToBed,
  type Handle,
  MIN_BED_SIDE_IN,
  normalizeAngle,
  normalizeCorners,
  outlinePoints,
  resizeBedTo,
  ROTATION_STEP_DEG,
  signedArea2,
} from '../core/layout';
import { PLANTING_PX_PER_INCH } from './viewport';
import type { Point } from '../core/geometry';

/** Bed edges and sizes snap to this step, in inches. */
export const LAYOUT_SNAP_IN = 6;
export function snapTo(v: number, step = LAYOUT_SNAP_IN): number {
  // `+ 0` folds -0 into 0 so snapped values compare and serialize cleanly.
  return Math.round(v / step) * step + 0;
}
/**
 * A place values stick to: multiples of `step`, within `tolerance` of one (in the value's own
 * units, as seen from the current zoom). Earlier detents in a list win over later ones.
 */
export interface Detent {
  step: number;
  tolerance: number;
}
/** The nearest multiple of a detent's step that `v` is within the detent's tolerance of, else null. */
export function detentNear(v: number, detents: Detent[]): number | null {
  for (const { step, tolerance } of detents) {
    const nearest = Math.round(v / step) * step;
    // Never reach past half a step: wider than that just means every value snaps.
    if (Math.abs(v - nearest) <= Math.min(tolerance, step / 2)) return nearest + 0;
  }
  return null;
}
/** Whether edits stick to detents, and how far (in screen px) a length detent pulls at this zoom. */
export interface SnapOptions {
  /** Screen pixels per inch, so a detent pulls the same distance on screen at any zoom. */
  zoom: number;
  /** Alt held: no detents, just whole inches and degrees. */
  free?: boolean;
}
/** Lengths stick to whole feet (a stronger pull) and half feet; between them they move by the inch. */
const LENGTH_DETENT_PX = [
  { step: 12, px: 12 },
  { step: 6, px: 7 },
];
/** How close (screen px) an edge must come to another bed's edge or center to line up with it. */
export const ALIGN_PX = 14;
/** A line to draw where an edit has snapped: a vertical line at x = `at`, or a horizontal one at y = `at`. */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
}
/** Positions along each garden axis that edits line up with: other beds' edges and centers. */
export interface AlignTargets {
  xs: number[];
  ys: number[];
}
/** Edges and centers of `beds`, as alignment targets. */
export function alignTargets(beds: Bed[]): AlignTargets {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const b of beds) {
    const box = bedBounds(b);
    xs.push(box.x0, (box.x0 + box.x1) / 2, box.x1);
    ys.push(box.y0, (box.y0 + box.y1) / 2, box.y1);
  }
  return { xs, ys };
}
/**
 * A garden coordinate as an edit drops it: it lines up with the nearest of `targets` (other
 * beds) if one is close, else sticks to a foot or half-foot grid mark, else goes by the inch.
 * `guide` is the position to draw a guide line at when it snapped to something, and `kind`
 * which sort of thing it was.
 */
export function snapCoordinate(
  v: number,
  targets: number[],
  { zoom, free = false }: SnapOptions = DEFAULT_SNAP,
): { value: number; guide: number | null; kind: 'target' | 'grid' | null } {
  if (!free) {
    let near: number | null = null;
    for (const t of targets) {
      if (Math.abs(t - v) <= ALIGN_PX / zoom && (near === null || Math.abs(t - v) < Math.abs(near - v))) near = t;
    }
    if (near !== null) return { value: near, guide: near, kind: 'target' };
    const mark = detentNear(v, lengthDetents(zoom));
    if (mark !== null) return { value: mark + 0, guide: mark + 0, kind: 'grid' };
  }
  return { value: Math.round(v) + 0, guide: null, kind: null };
}
/** The detents for lengths at `zoom`. */
export function lengthDetents(zoom: number): Detent[] {
  return LENGTH_DETENT_PX.map(({ step, px }) => ({ step, tolerance: px / zoom }));
}
/** The editor's default snapping, at the planting view's scale (for callers with no zoom of their own). */
export const DEFAULT_SNAP: SnapOptions = { zoom: PLANTING_PX_PER_INCH };
/**
 * A length or position as an edit drops it: whole inches, except that it sticks to the nearest
 * foot or half-foot mark when the pointer is close enough to feel it.
 */
export function snapLength(v: number, { zoom, free = false }: SnapOptions = DEFAULT_SNAP): number {
  const detent = free ? null : detentNear(v, lengthDetents(zoom));
  return (detent ?? Math.round(v)) + 0;
}
/**
 * How far to shift a bed, which was dragged by `delta` inches, so that one of its `edges`
 * (coordinates before the move) lines up with a target or lands on a foot mark if any is close
 * (see snapCoordinate); otherwise it moves by the whole inch. Of several edges in reach, the
 * one needing the smallest nudge wins. `guide` is where to draw a guide line, if it snapped.
 */
export function shiftAxis(
  edges: number[],
  delta: number,
  targets: number[] = [],
  snap: SnapOptions = DEFAULT_SNAP,
): { shift: number; guide: number | null } {
  let best: { shift: number; guide: number; aligned: boolean } | null = null;
  for (const e of edges) {
    const { value, guide, kind } = snapCoordinate(e + delta, targets, snap);
    if (guide === null) continue;
    const shift = value - e;
    const aligned = kind === 'target';
    // Lining up with another bed beats a grid mark; otherwise the smaller nudge wins.
    const better =
      best === null ||
      (aligned && !best.aligned) ||
      (aligned === best.aligned && Math.abs(shift - delta) < Math.abs(best.shift - delta));
    if (better) best = { shift, guide, aligned };
  }
  return best ? { shift: best.shift + 0, guide: best.guide } : { shift: Math.round(delta) + 0, guide: null };
}
/** shiftAxis without the guide, for edits with no use for one. */
export function snapShift(edges: number[], delta: number, snap: SnapOptions = DEFAULT_SNAP, targets: number[] = []): number {
  return shiftAxis(edges, delta, targets, snap).shift;
}
/**
 * Dragging a bed by (dx, dy) from `bed`'s place: how far it actually moves, with its box's sides
 * (and center) snapping to other beds' (`targets`) and to the grid, and the guide lines to draw.
 */
export function moveSnapped(
  bed: Bed,
  dx: number,
  dy: number,
  targets: AlignTargets,
  snap: SnapOptions = DEFAULT_SNAP,
): { dx: number; dy: number; guides: Guide[] } {
  const box = bedBounds(bed);
  const x = shiftAxis([box.x0, (box.x0 + box.x1) / 2, box.x1], dx, targets.xs, snap);
  const y = shiftAxis([box.y0, (box.y0 + box.y1) / 2, box.y1], dy, targets.ys, snap);
  const guides: Guide[] = [];
  if (x.guide !== null) guides.push({ axis: 'x', at: x.guide });
  if (y.guide !== null) guides.push({ axis: 'y', at: y.guide });
  return { dx: x.shift, dy: y.shift, guides };
}
/** Angles stick near every 45° (strongly) and every 15° (lightly); between them they turn by the degree. */
export const ANGLE_DETENTS: Detent[] = [
  { step: 45, tolerance: 6 },
  { step: 15, tolerance: 2 },
];
/** An angle as an edit drops it: whole degrees, sticking to a detent when close; normalized to 0…360. */
export function magneticAngle(deg: number, free = false): number {
  const detent = free ? null : detentNear(deg, ANGLE_DETENTS);
  return normalizeAngle(detent ?? Math.round(deg));
}
/** Where a bed's name goes: a point on the shape's highest edge or corner, and how the text hangs from it. */
export interface LabelAnchor {
  x: number;
  y: number;
  /** `start`: the name begins at x (a flat top edge, from its left end). `middle`: centered on x (a single highest point). */
  align: 'start' | 'middle';
}
/**
 * Where to put a bed's name so it sits just above the shape itself, not above its bounding
 * box's corner (which for an ellipse, a turned bed or an odd polygon can be far from any of
 * it). The name goes over the highest point of the outline: from the left end of the top edge
 * if it's flat, or centered over the highest corner or curve. The caller lifts it clear of the line.
 */
export function labelAnchor(bed: Bed): LabelAnchor {
  const pts = outlinePoints(bed);
  const top = Math.min(...pts.map((p) => p.y));
  const highest = pts.filter((p) => p.y <= top + 1e-6);
  if (highest.length > 1) {
    const left = highest.reduce((a, b) => (b.x < a.x ? b : a));
    return { x: left.x, y: top, align: 'start' };
  }
  return { x: highest[0].x, y: top, align: 'middle' };
}
/** The axis-aligned box spanned by two points, whichever way round they are. */
export function boxBetween(a: Point, b: Point): { x: number; y: number; width: number; height: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}
/**
 * CSS border-radius for the outer edge of a bed drawn with a `borderPx` border, so the border's
 * inner edge curves with `radiusIn`. A square bed stays square all the way round.
 */
export function outerRadiusPx(radiusIn: number, pxPerInch: number, borderPx: number): number {
  return radiusIn === 0 ? 0 : radiusIn * pxPerInch + borderPx;
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
/**
 * Which garden axis a bed's local `axis` runs along when the bed is turned a multiple of 90°,
 * and whether it points the same way (+1) or the opposite way (−1); null for any other angle.
 */
function gardenAxisOf(rotationDeg: number, axis: 'x' | 'y'): { garden: 'x' | 'y'; sign: 1 | -1 } | null {
  if (rotationDeg % 90 !== 0) return null;
  const r = (rotationDeg * Math.PI) / 180;
  const v = axis === 'x' ? { x: Math.cos(r), y: Math.sin(r) } : { x: -Math.sin(r), y: Math.cos(r) };
  const garden = Math.abs(v.x) > 0.5 ? 'x' : 'y';
  return { garden, sign: v[garden] > 0 ? 1 : -1 };
}
/**
 * The bed resized by dragging `handle` to the garden point `pointer`: each side the handle
 * moves is measured from the fixed opposite side and never shrinks below MIN_BED_SIDE_IN, even
 * if the pointer crosses over to the other side. The moving edge goes by the inch and sticks
 * to foot marks of the size (see snapLength); on a bed turned a multiple of 90° it also lines
 * up with other beds (`targets`) and the garden's own grid, whichever is closest, and `guides`
 * says where to draw lines for that.
 */
export function resizeSnapped(
  bed: Bed,
  handle: Handle,
  pointer: Point,
  targets: AlignTargets = { xs: [], ys: [] },
  snap: SnapOptions = DEFAULT_SNAP,
): { bed: Bed; guides: Guide[] } {
  const guides: Guide[] = [];
  const local = gardenToBed(bed, pointer);
  /** The new side length along one local axis for the pointer, snapped. */
  function side(axis: 'x' | 'y'): number {
    const s = axis === 'x' ? handle.sx : handle.sy;
    const size = axis === 'x' ? bed.widthIn : bed.heightIn;
    if (s === 0) return size;
    const raw = s === 1 ? local[axis] : size - local[axis];
    let best = { length: snapLength(raw, snap), distance: Infinity };
    // Closer to the pointer than the size's own foot marks, an aligned edge wins.
    if (best.length !== Math.round(raw)) best.distance = Math.abs(best.length - raw);
    const g = gardenAxisOf(bed.rotationDeg, axis);
    if (g && !snap.free) {
      // The fixed side's position along the garden axis, and how a longer side moves the other one.
      const fixedLocal = { x: axis === 'x' ? (s === 1 ? 0 : size) : local.x, y: axis === 'y' ? (s === 1 ? 0 : size) : local.y };
      const fixed = bedToGarden(bed, fixedLocal)[g.garden];
      const direction = g.sign * s;
      const { value, guide, kind } = snapCoordinate(pointer[g.garden], targets[g.garden === 'x' ? 'xs' : 'ys'], snap);
      if (guide !== null) {
        const length = (value - fixed) * direction;
        const distance = Math.abs(length - raw);
        if (length >= MIN_BED_SIDE_IN && (kind === 'target' || distance <= best.distance)) {
          best = { length, distance };
          guides.push({ axis: g.garden, at: guide });
        }
      }
    }
    return Math.max(MIN_BED_SIDE_IN, best.length);
  }
  const width = side('x');
  const height = side('y');
  return { bed: resizeBedTo(bed, width, height, handle), guides };
}
/** resizeSnapped without the guides, for callers with no use for them. */
export function resizeFromPointer(bed: Bed, handle: Handle, pointer: Point, snap: SnapOptions = DEFAULT_SNAP): Bed {
  return resizeSnapped(bed, handle, pointer, undefined, snap).bed;
}
/**
 * The polygon bed with corner `index` dragged to the garden point `pointer`, snapped (see
 * snapLength) measured from the bed's top-left. The box re-fits the corners, and the other corners
 * stay where they are in the garden. The bed comes back unchanged if the move would collapse
 * it (a box under the minimum side, or no area).
 */
export function moveCorner(bed: Bed, index: number, pointer: Point, snap: SnapOptions = DEFAULT_SNAP): Bed {
  if (!bed.points || index < 0 || index >= bed.points.length) return bed;
  const local = gardenToBed(bed, pointer);
  const moved = bed.points.map((q, i) => (i === index ? { x: snapLength(local.x, snap), y: snapLength(local.y, snap) } : q));
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
/**
 * The bed's rotation when its rotate handle (which sits above the top edge when unturned) is
 * dragged to the garden point `pointer`: by the degree, sticking near the 15° and 45° marks
 * (see magneticAngle).
 */
export function rotationFromPointer(bed: Pick<Bed, 'cx' | 'cy'>, pointer: Point, free = false): number {
  const deg = (Math.atan2(pointer.y - bed.cy, pointer.x - bed.cx) * 180) / Math.PI + 90;
  return magneticAngle(deg, free);
}
/**
 * The angle one press of a turn button reaches: the next multiple of `step` in `direction`
 * (+1 clockwise, −1 anticlockwise), even from an angle between two, normalized.
 */
export function stepAngle(deg: number, direction: 1 | -1, step = ROTATION_STEP_DEG): number {
  const marks = deg / step;
  // A hair of tolerance so an angle that is on a mark (up to float noise) moves a whole step.
  const next = direction === 1 ? Math.floor(marks + 1e-9) + 1 : Math.ceil(marks - 1e-9) - 1;
  return normalizeAngle(next * step);
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
 * "54in", "54″", or a bare number, which means feet (or inches, with `bareUnit: 'in'`). Returns
 * null for anything else, or a length that isn't positive (zero too, with `allowZero`).
 */
export function parseLength(
  text: string,
  { bareUnit = 'ft', allowZero = false }: { bareUnit?: 'ft' | 'in'; allowZero?: boolean } = {},
): number | null {
  const t = text.trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  const n = '(\\d+(?:\\.\\d+)?)';
  const patterns: [RegExp, (m: RegExpMatchArray) => number][] = [
    [new RegExp(`^${n}\\s*(?:'|ft|feet|foot)\\s*(?:${n}\\s*(?:"|in|inch|inches)?)?$`), (m) => +m[1] * 12 + (m[2] ? +m[2] : 0)],
    [new RegExp(`^${n}\\s*(?:"|in|inch|inches)$`), (m) => +m[1]],
    [new RegExp(`^${n}\\s+${n}$`), (m) => +m[1] * 12 + +m[2]],
    [new RegExp(`^${n}$`), (m) => +m[1] * (bareUnit === 'in' ? 1 : 12)],
  ];
  for (const [re, toInches] of patterns) {
    const m = t.match(re);
    if (m) {
      const v = toInches(m);
      return v > 0 || (allowZero && v === 0) ? v : null;
    }
  }
  return null;
}