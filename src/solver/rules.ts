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
