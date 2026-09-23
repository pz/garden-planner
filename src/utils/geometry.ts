import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';

export interface Point {
  x: number;
  y: number;
}

export interface GroupBox {
  groupId: string;
  cropId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export const GROUP_BOX_PAD_IN = 1.25;

/** Axis-aligned bounding box around a set of circles, expanded by each circle's own radius. */
export function boundingBox(points: { x: number; y: number; r: number }[], padIn: number): Omit<GroupBox, 'groupId' | 'cropId'> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x - p.r);
    minY = Math.min(minY, p.y - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    maxY = Math.max(maxY, p.y + p.r);
  }
  return { left: minX - padIn, top: minY - padIn, width: maxX - minX + padIn * 2, height: maxY - minY + padIn * 2 };
}

/** One bounding box per patch (a groupId shared by more than one plant) so it reads as a single entity. */
export function computeGroupBoxes(plants: PlantInstance[]): GroupBox[] {
  const byGroup = new Map<string, PlantInstance[]>();
  for (const p of plants) {
    const members = byGroup.get(p.groupId);
    if (members) members.push(p);
    else byGroup.set(p.groupId, [p]);
  }
  const boxes: GroupBox[] = [];
  for (const [groupId, members] of byGroup) {
    if (members.length < 2) continue;
    const points = members.map((m) => ({ x: m.x, y: m.y, r: getCrop(m.cropId).spacingIn / 2 }));
    boxes.push({ groupId, cropId: members[0].cropId, ...boundingBox(points, GROUP_BOX_PAD_IN) });
  }
  return boxes;
}

export const AXIS_LOCK_THRESHOLD_FACTOR = 0.6;

/**
 * Locks a drag to whichever of the bed's two edges it's more aligned with. Patches always
 * run horizontal or vertical, never diagonal — simpler to reason about in a small bed than
 * a freely-rotated patch, and it keeps every patch's footprint an axis-aligned rectangle.
 */
export function lockedAxis(dx: number, dy: number): Point {
  return Math.abs(dx) >= Math.abs(dy) ? { x: 1, y: 0 } : { x: 0, y: 1 };
}

/**
 * Ghost points for a patch dragged out from `origin` along a locked `axis` — one column per
 * spacing step along the axis, one row per spacing step perpendicular to it, so a single drag
 * sweeps out a line (rows = 0) or a rectangular grid (rows > 0), matching "drag a patch to
 * size." Only a ghost's own center has to stay inside the bed, matching plant placement rules
 * generally — its spacing ring may extend past the edge, but not past a rounded corner.
 */
export function computeGhosts(
  origin: Point,
  axis: Point,
  cursor: Point,
  spacingIn: number,
  boundW: number,
  boundH: number,
  cornerRadiusIn = 0,
): Point[] {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const u = dx * axis.x + dy * axis.y; // signed distance along the axis
  const v = -dx * axis.y + dy * axis.x; // signed distance perpendicular to it
  const cols = Math.max(0, Math.floor(Math.abs(u) / spacingIn));
  const rows = Math.max(0, Math.floor(Math.abs(v) / spacingIn));
  const colSign = u < 0 ? -1 : 1;
  const rowSign = v < 0 ? -1 : 1;
  const perpX = -axis.y;
  const perpY = axis.x;

  const pts: Point[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      if (row === 0 && col === 0) continue; // origin is already a placed plant
      const x = origin.x + axis.x * spacingIn * col * colSign + perpX * spacingIn * row * rowSign;
      const y = origin.y + axis.y * spacingIn * col * colSign + perpY * spacingIn * row * rowSign;
      if (!isInsideBed({ x, y }, boundW, boundH, cornerRadiusIn)) continue;
      pts.push({ x, y });
    }
  }
  return pts;
}

/** Slack for floating-point error when checking a point that was just projected onto an arc. */
const EPSILON_IN = 1e-6;

/** Corner-arc center nearest to `p`, or null when `p` isn't in one of the bed's corner squares. */
function cornerCenter(p: Point, w: number, h: number, r: number): Point | null {
  if (r <= 0) return null;
  const cx = p.x < r ? r : p.x > w - r ? w - r : null;
  const cy = p.y < r ? r : p.y > h - r ? h - r : null;
  return cx === null || cy === null ? null : { x: cx, y: cy };
}

/**
 * Whether a plant center at `p` lies inside a `w`×`h` bed whose corners are rounded with
 * radius `r` (all in inches). Points exactly on the edge or on a corner arc count as inside.
 */
export function isInsideBed(p: Point, w: number, h: number, r = 0): boolean {
  if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) return false;
  const c = cornerCenter(p, w, h, r);
  return !c || Math.hypot(p.x - c.x, p.y - c.y) <= r + EPSILON_IN;
}

/**
 * Nearest point to `p` inside a `w`×`h` bed with corners rounded to radius `r`. Beyond a
 * corner (past both of its arc center's coordinates) that's a radial projection onto the
 * arc; everywhere else it's a plain clamp to the rectangle.
 */
export function clampToBed(p: Point, w: number, h: number, r = 0): Point {
  const c = cornerCenter(p, w, h, r);
  if (c) {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d <= r) return { x: p.x, y: p.y };
    return { x: c.x + ((p.x - c.x) / d) * r, y: c.y + ((p.y - c.y) / d) * r };
  }
  return { x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) };
}

/**
 * Clamp a proposed (dx, dy) translation so every member of a group keeps its center inside
 * the bed once moved — keeping the whole patch rigid (every member shifts by the same
 * amount) rather than letting the bed edge distort its shape. With rounded corners
 * (`cornerRadiusIn` > 0) the patch slides along a corner's arc rather than poking past it.
 */
export function clampGroupDelta(
  members: PlantInstance[],
  dx: number,
  dy: number,
  boundW: number,
  boundH: number,
  cornerRadiusIn = 0,
): Point {
  const rectClamp = (d: Point): Point => {
    let minDx = -Infinity;
    let maxDx = Infinity;
    let minDy = -Infinity;
    let maxDy = Infinity;
    for (const m of members) {
      minDx = Math.max(minDx, -m.x);
      maxDx = Math.min(maxDx, boundW - m.x);
      minDy = Math.max(minDy, -m.y);
      maxDy = Math.min(maxDy, boundH - m.y);
    }
    return { x: Math.min(maxDx, Math.max(minDx, d.x)), y: Math.min(maxDy, Math.max(minDy, d.y)) };
  };
  const fits = (d: Point) =>
    members.every((m) => isInsideBed({ x: m.x + d.x, y: m.y + d.y }, boundW, boundH, cornerRadiusIn));

  let d = rectClamp({ x: dx, y: dy });
  if (cornerRadiusIn <= 0 || fits(d)) return d;

  // Each member's allowed translations form a convex region (the bed, shifted), so repeatedly
  // pulling the offending member back onto its corner arc converges on a delta that fits all
  // of them — normally in one or two steps, since only the member nearest the corner binds.
  for (let i = 0; i < 32 && !fits(d); i++) {
    for (const m of members) {
      const at = { x: m.x + d.x, y: m.y + d.y };
      const fixed = clampToBed(at, boundW, boundH, cornerRadiusIn);
      d = rectClamp({ x: d.x + fixed.x - at.x, y: d.y + fixed.y - at.y });
    }
  }
  if (fits(d)) return d;

  // Fallback: the largest fraction of the move toward `d` that still fits (none, if even
  // standing still doesn't — e.g. a patch saved before corners were enforced).
  if (!fits({ x: 0, y: 0 })) return { x: 0, y: 0 };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits({ x: d.x * mid, y: d.y * mid })) lo = mid;
    else hi = mid;
  }
  return { x: d.x * lo, y: d.y * lo };
}
