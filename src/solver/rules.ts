import type { Point } from '../types';
import { isInsideOutline, type Outline } from '../core/geometry';
import { HARD_SPACING_FACTOR } from '../core/spacing';

export { HARD_SPACING_FACTOR };

// The spacing rule and its soft cost, written so the solver's fast checks agree exactly with
// core/spacing.ts: the same average-of-spacings gap, the same distance formula, the same
// strict comparisons.

/** The gap two plants of different patches want between them: the average of their crops' spacing, in inches. */
export const requiredGap = (spacingA: number, spacingB: number): number => (spacingA + spacingB) / 2;

/** Distance between two points, computed the way core/spacing.ts does. */
export const distance = (a: Point, b: Point): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/** Whether two plants `d` apart with required gap `g` are in a spacing conflict at all (exactly the gap is fine). */
export const isSpacingConflict = (d: number, g: number): boolean => d < g;

/** Whether the conflict is a `problem`-severity one: closer than HARD_SPACING_FACTOR × the gap. */
export const isProblemSpacing = (d: number, g: number): boolean => d < g * HARD_SPACING_FACTOR;

/** Slack that keeps the solver off the exact edge of the problem threshold, where rounding could tip it over, in inches. */
export const HARD_SLACK_IN = 1e-9;

/** Whether placing two plants `d` apart, with required gap `g`, is forbidden. */
export const violatesHardSpacing = (d: number, g: number): boolean => d < g * HARD_SPACING_FACTOR + HARD_SLACK_IN;

/**
 * The soft cost of two plants of different patches sitting `d` apart with required gap `g`:
 * 0 at the full gap and beyond, 1 at the hard floor, quadratic between, so slight crowding is
 * cheap and heavy crowding is expensive.
 */
export function spacingPenalty(d: number, g: number): number {
  if (d >= g) return 0;
  const t = (g - d) / ((1 - HARD_SPACING_FACTOR) * g);
  return t * t;
}

const RIM_SAMPLES: readonly Point[] = (() => {
  const h = Math.SQRT1_2;
  // Written out so the axis-aligned samples are exactly 0 (cos(π/2) is not), and a plant flush with a straight wall does not count the sample along the wall as outside.
  return [{ x: 1, y: 0 }, { x: h, y: h }, { x: 0, y: 1 }, { x: -h, y: h }, { x: -1, y: 0 }, { x: -h, y: -h }, { x: 0, y: -1 }, { x: h, y: -h }];
})();

/** How many points on a plant's growing-room rim are sampled for the edge-spill estimate. */
export const RIM_SAMPLE_COUNT = RIM_SAMPLES.length;

/** The share (0 to 1) of a plant's growing room that lies outside the bed, estimated from 8 points on the rim of its disc. */
export function edgeSpill(center: Point, spacingIn: number, outline: Outline): number {
  const r = spacingIn / 2;
  let outside = 0;
  for (const s of RIM_SAMPLES) if (!isInsideOutline({ x: center.x + s.x * r, y: center.y + s.y * r }, outline)) outside++;
  return outside / RIM_SAMPLES.length;
}

const distToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Slack for rounding when a point is exactly the clearance from the edge, in inches. */
const CLEARANCE_EPS = 1e-9;

/**
 * Whether a plant center at `p` is inside `outline` and at least `clearance` inches from its edge,
 * so a circle of that radius around it lies wholly inside the bed. Exact for rectangles (rounded
 * corners included) and polygons; for an ellipse, a point inside the ellipse shrunk by `clearance`
 * on both axes that also passes a ring of samples, which is within a hair of exact. With a
 * clearance of 0 it is the plain inside test.
 */
export function insideWithClearance(p: Point, clearance: number, outline: Outline): boolean {
  if (!isInsideOutline(p, outline)) return false;
  if (clearance <= 0) return true;
  const eps = CLEARANCE_EPS;
  switch (outline.shape) {
    case 'rect': {
      const { widthIn: w, heightIn: h, cornerRadiusIn: r } = outline;
      if (p.x < clearance - eps || p.y < clearance - eps || p.x > w - clearance + eps || p.y > h - clearance + eps) return false;
      if (r > 0) {
        const cx = p.x < r ? r : p.x > w - r ? w - r : null;
        const cy = p.y < r ? r : p.y > h - r ? h - r : null;
        if (cx !== null && cy !== null) return Math.hypot(p.x - cx, p.y - cy) <= r - clearance + eps;
      }
      return true;
    }
    case 'ellipse': {
      const a = outline.widthIn / 2 - clearance;
      const b = outline.heightIn / 2 - clearance;
      if (a <= 0 || b <= 0) return false;
      const nx = (p.x - outline.widthIn / 2) / a;
      const ny = (p.y - outline.heightIn / 2) / b;
      if (nx * nx + ny * ny > 1 + eps) return false;
      for (let i = 0; i < 16; i++) {
        const t = (i / 16) * 2 * Math.PI;
        if (!isInsideOutline({ x: p.x + clearance * Math.cos(t) * (1 - 1e-9), y: p.y + clearance * Math.sin(t) * (1 - 1e-9) }, outline)) return false;
      }
      return true;
    }
    case 'polygon': {
      const pts = outline.points;
      for (let i = 0; i < pts.length; i++) if (distToSegment(p, pts[i], pts[(i + 1) % pts.length]) < clearance - eps) return false;
      return true;
    }
  }
}

