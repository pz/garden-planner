import type { PlantInstance, Point } from '../types';

export type { Point };

/**
 * The region plant centers must stay inside, in a bed's local frame (inches from its top-left
 * corner, 0…widthIn × 0…heightIn). Built from a bed by `bedOutline` in layout.ts.
 */
export type Outline =
  | { shape: 'rect'; widthIn: number; heightIn: number; cornerRadiusIn: number }
  | { shape: 'ellipse'; widthIn: number; heightIn: number }
  | { shape: 'polygon'; widthIn: number; heightIn: number; points: Point[] };

/** A plain rectangle outline, optionally with rounded corners. */
export function rectOutline(widthIn: number, heightIn: number, cornerRadiusIn = 0): Outline {
  return { shape: 'rect', widthIn, heightIn, cornerRadiusIn };
}

/** Most plants one patch may hold; a grid asking for more is rejected rather than built. */
export const MAX_PATCH_PLANTS = 1000;

/**
 * A `columns` × `rows` block of points `spacingIn` apart, starting at `origin` (which is one of
 * the points). With axis `x`, columns run left to right and rows step downward from the origin;
 * with axis `y`, columns run top to bottom and rows step rightward. Points come out row by row.
 * Unlike `computeGhosts`, this includes the origin and only grows in the positive directions —
 * choose the origin at the block's top-left to place a block that way.
 */
export function gridPoints(origin: Point, axis: 'x' | 'y', columns: number, rows: number, spacingIn: number): Point[] {
  const pts: Point[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const along = col * spacingIn;
      const across = row * spacingIn;
      pts.push(axis === 'x' ? { x: origin.x + along, y: origin.y + across } : { x: origin.x + across, y: origin.y + along });
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

function distToSegment(p: Point, a: Point, b: Point): { d: number; q: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: Math.hypot(p.x - q.x, p.y - q.y), q };
}

/** Whether `p` is inside (or on the boundary of) the polygon with corners `pts`, in order. */
export function isInsidePolygon(p: Point, pts: Point[]): boolean {
  for (let i = 0; i < pts.length; i++) {
    if (distToSegment(p, pts[i], pts[(i + 1) % pts.length]).d <= EPSILON_IN) return true;
  }
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether a plant center at `p` lies inside `outline`. Points on the boundary count as inside. */
export function isInsideOutline(p: Point, outline: Outline): boolean {
  switch (outline.shape) {
    case 'rect':
      return isInsideBed(p, outline.widthIn, outline.heightIn, outline.cornerRadiusIn);
    case 'ellipse': {
      const a = outline.widthIn / 2;
      const b = outline.heightIn / 2;
      const nx = (p.x - a) / a;
      const ny = (p.y - b) / b;
      return nx * nx + ny * ny <= 1 + EPSILON_IN;
    }
    case 'polygon':
      return isInsidePolygon(p, outline.points);
  }
}

/**
 * A point inside `outline` near `p`: `p` itself if it's already inside. Outside a polygon it's
 * the nearest point on its boundary; outside an ellipse, the boundary point on the line to its
 * center (not quite the nearest for a long, thin ellipse, but always on the outline).
 */
export function clampToOutline(p: Point, outline: Outline): Point {
  if (isInsideOutline(p, outline)) return { x: p.x, y: p.y };
  switch (outline.shape) {
    case 'rect':
      return clampToBed(p, outline.widthIn, outline.heightIn, outline.cornerRadiusIn);
    case 'ellipse': {
      const a = outline.widthIn / 2;
      const b = outline.heightIn / 2;
      const k = 1 / Math.hypot((p.x - a) / a, (p.y - b) / b);
      return { x: a + (p.x - a) * k, y: b + (p.y - b) * k };
    }
    case 'polygon': {
      let best: Point = outline.points[0];
      let bestD = Infinity;
      const pts = outline.points;
      for (let i = 0; i < pts.length; i++) {
        const { d, q } = distToSegment(p, pts[i], pts[(i + 1) % pts.length]);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
      return best;
    }
  }
}

/**
 * Clamp a proposed (dx, dy) translation so every member of a group keeps its center inside
 * the bed's outline once moved — keeping the whole patch rigid (every member shifts by the
 * same amount) rather than letting the bed edge distort its shape. Against a curved or slanted
 * edge (a rounded corner, an ellipse, a polygon side) the patch slides along it rather than
 * poking past.
 */
export function clampGroupDelta(members: PlantInstance[], dx: number, dy: number, outline: Outline): Point {
  // Every outline lies within its 0…widthIn × 0…heightIn box, so that's the first, cheap clamp.
  const rectClamp = (d: Point): Point => {
    let minDx = -Infinity;
    let maxDx = Infinity;
    let minDy = -Infinity;
    let maxDy = Infinity;
    for (const m of members) {
      minDx = Math.max(minDx, -m.x);
      maxDx = Math.min(maxDx, outline.widthIn - m.x);
      minDy = Math.max(minDy, -m.y);
      maxDy = Math.min(maxDy, outline.heightIn - m.y);
    }
    return { x: Math.min(maxDx, Math.max(minDx, d.x)), y: Math.min(maxDy, Math.max(minDy, d.y)) };
  };
  const fits = (d: Point) => members.every((m) => isInsideOutline({ x: m.x + d.x, y: m.y + d.y }, outline));

  let d = rectClamp({ x: dx, y: dy });
  if (fits(d)) return d;

  // Repeatedly pulling the offending member back onto the outline converges on a delta that
  // fits all of them — normally in one or two steps, since only the member nearest the edge
  // binds. (Exactly so for convex outlines; a concave polygon may need the fallback below.)
  for (let i = 0; i < 32 && !fits(d); i++) {
    for (const m of members) {
      const at = { x: m.x + d.x, y: m.y + d.y };
      const fixed = clampToOutline(at, outline);
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
