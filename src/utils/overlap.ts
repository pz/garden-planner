import type { Bed } from '../types';
import type { Point } from './geometry';
import { bedToGarden, boxCorners, signedArea2, type Handle, resizeBedTo } from './layout';

/** Cross products smaller than this are zero: noise from turning a bed by an angle, not geometry. */
const EPS = 1e-9;
/** How far (inches) inside a polygon's edge a probe point sits, and how close to an edge counts as on it. */
const PROBE_IN = 1e-3;
const ON_EDGE_IN = 1e-4;

/** A bed's outline in garden coordinates: its corners, or a fine polygon around an ellipse. */
export function bedPolygon(bed: Bed): Point[] {
  if (bed.shape === 'polygon' && bed.points) return bed.points.map((q) => bedToGarden(bed, q));
  if (bed.shape === 'ellipse') {
    const n = 96;
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

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Whether two segments cross each other at a point interior to both (touching and overlapping don't count). */
function properlyCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  const sign = (v: number) => (Math.abs(v) < EPS ? 0 : v > 0 ? 1 : -1);
  return sign(d1) * sign(d2) < 0 && sign(d3) * sign(d4) < 0;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Whether `p` is inside `poly` and clear of its edges (a point on the boundary is not strictly inside). */
function strictlyInside(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distanceToSegment(p, poly[j], poly[i]) <= ON_EDGE_IN) return false;
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Points just inside each edge of `poly` (at a quarter, half and three quarters along it). */
function probesInside(poly: Point[]): Point[] {
  // Clockwise on screen (positive signed area) puts the inside to the right of each edge.
  const sign = signedArea2(poly) >= 0 ? 1 : -1;
  const probes: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const nx = (-sign * (b.y - a.y)) / len;
    const ny = (sign * (b.x - a.x)) / len;
    for (const t of [0.25, 0.5, 0.75]) {
      probes.push({ x: a.x + (b.x - a.x) * t + nx * PROBE_IN, y: a.y + (b.y - a.y) * t + ny * PROBE_IN });
    }
  }
  return probes;
}

/**
 * Whether two polygons share any area. Sharing only an edge or a corner doesn't count, so beds
 * can sit flush against each other. Two polygons share area if their outlines cross, or if a
 * point just inside one's edge is inside the other (which catches containment, and shapes with
 * coincident edges, where nothing crosses).
 */
export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (properlyCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return probesInside(a).some((p) => strictlyInside(p, b)) || probesInside(b).some((p) => strictlyInside(p, a));
}

function box(poly: Point[]) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Whether two beds share any area (flush edges are fine). */
export function bedsOverlap(a: Bed, b: Bed): boolean {
  const pa = bedPolygon(a);
  const pb = bedPolygon(b);
  const ba = box(pa);
  const bb = box(pb);
  if (ba.x1 <= bb.x0 || bb.x1 <= ba.x0 || ba.y1 <= bb.y0 || bb.y1 <= ba.y0) return false;
  return polygonsOverlap(pa, pb);
}

/** The ids of the other beds that `bed` shares area with. */
export function overlappingIds(bed: Bed, beds: Bed[]): string[] {
  return beds.filter((o) => o.id !== bed.id && bedsOverlap(bed, o)).map((o) => o.id);
}

/** Every pair of beds that overlap, as [idA, idB] in the beds' order. */
export function findOverlaps(beds: Bed[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < beds.length; i++) {
    for (let j = i + 1; j < beds.length; j++) {
      if (bedsOverlap(beds[i], beds[j])) pairs.push([beds[i].id, beds[j].id]);
    }
  }
  return pairs;
}

/**
 * Whether turning `prev` into `next` (or adding `next`, with `prev` null) makes it overlap a bed
 * it didn't overlap before. A bed that already overlaps something may still be moved, as long
 * as it doesn't run into anything new, so a garden saved in a bad state can be fixed.
 */
export function introducesOverlap(beds: Bed[], prev: Bed | null, next: Bed): boolean {
  const others = beds.filter((b) => b.id !== next.id);
  const before = new Set(prev ? overlappingIds(prev, others) : []);
  return overlappingIds(next, others).some((id) => !before.has(id));
}

/**
 * The (dx, dy) nearest to `desired` that doesn't run `bed` into another bed, given `last`, the
 * most recent offset that was fine. If `desired` is clear it's used as is; otherwise the bed
 * slides along whichever axis is free, or stops where it meets the other bed.
 */
export function constrainMove(
  beds: Bed[],
  bed: Bed,
  desired: { dx: number; dy: number },
  last: { dx: number; dy: number },
): { dx: number; dy: number } {
  const clear = (d: { dx: number; dy: number }) =>
    !introducesOverlap(beds, bed, { ...bed, cx: bed.cx + d.dx, cy: bed.cy + d.dy });
  if (clear(desired)) return desired;
  const candidates = [desired, { dx: desired.dx, dy: last.dy }, { dx: last.dx, dy: desired.dy }];
  let best = last;
  let bestDistance = Math.hypot(desired.dx - last.dx, desired.dy - last.dy);
  for (const c of candidates) {
    const reached = farthestClear(last, c, (d) => clear(d));
    const distance = Math.hypot(desired.dx - reached.dx, desired.dy - reached.dy);
    if (distance < bestDistance) {
      best = reached;
      bestDistance = distance;
    }
  }
  return best;
}

/** The point furthest from `from` toward `to`, in whole inches, that is still clear (`from` itself must be). */
function farthestClear(
  from: { dx: number; dy: number },
  to: { dx: number; dy: number },
  clear: (d: { dx: number; dy: number }) => boolean,
): { dx: number; dy: number } {
  const at = (t: number) => ({
    dx: Math.round(from.dx + (to.dx - from.dx) * t) + 0,
    dy: Math.round(from.dy + (to.dy - from.dy) * t) + 0,
  });
  if (clear(to)) return to;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (clear(at(mid))) lo = mid;
    else hi = mid;
  }
  return at(lo);
}

/**
 * The size nearest to `desired` that doesn't run the resized `bed` into another bed, given `last`,
 * the most recent size that was fine. An axis that's free keeps moving while the other stops.
 */
export function constrainResize(
  beds: Bed[],
  bed: Bed,
  handle: Handle,
  desired: { w: number; h: number },
  last: { w: number; h: number },
): { w: number; h: number } {
  const resized = (s: { w: number; h: number }) => resizeBedTo(bed, s.w, s.h, handle);
  const clear = (s: { w: number; h: number }) => !introducesOverlap(beds, bed, resized(s));
  if (clear(desired)) return desired;
  const candidates = [desired, { w: desired.w, h: last.h }, { w: last.w, h: desired.h }];
  let best = last;
  let bestDistance = Math.hypot(desired.w - last.w, desired.h - last.h);
  for (const c of candidates) {
    const reached = farthestClear(
      { dx: last.w, dy: last.h },
      { dx: c.w, dy: c.h },
      (d) => clear({ w: d.dx, h: d.dy }),
    );
    const distance = Math.hypot(desired.w - reached.dx, desired.h - reached.dy);
    if (distance < bestDistance) {
      best = { w: reached.dx, h: reached.dy };
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Where to put a copy of `bed` so it overlaps nothing: the offset nearest to `preferred` (on a
 * 12″ grid around it) that's clear, or null if there's no room within a few garden-widths.
 */
export function findFreeOffset(
  bed: Bed,
  beds: Bed[],
  preferred: { dx: number; dy: number },
  step = 12,
  reach = 40,
): { dx: number; dy: number } | null {
  const candidates: { dx: number; dy: number }[] = [];
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      candidates.push({ dx: preferred.dx + i * step, dy: preferred.dy + j * step });
    }
  }
  candidates.sort((a, b) => Math.hypot(a.dx - preferred.dx, a.dy - preferred.dy) - Math.hypot(b.dx - preferred.dx, b.dy - preferred.dy));
  const found = candidates.find((c) => overlappingIds({ ...bed, cx: bed.cx + c.dx, cy: bed.cy + c.dy }, beds).length === 0);
  return found ?? null;
}
