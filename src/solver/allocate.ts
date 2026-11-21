import type { Bed } from '../types';

/** The area of a bed's shape, in square inches. */
export function bedArea(bed: Bed): number {
  const { widthIn: w, heightIn: h } = bed;
  if (bed.shape === 'ellipse') return (Math.PI * w * h) / 4;
  if (bed.shape === 'polygon' && bed.points) {
    let twice = 0;
    bed.points.forEach((p, i) => {
      const q = bed.points![(i + 1) % bed.points!.length];
      twice += p.x * q.y - q.x * p.y;
    });
    return Math.abs(twice) / 2;
  }
  const r = Math.min(bed.cornerRadiusIn ?? 0, w / 2, h / 2);
  return w * h - (4 - Math.PI) * r * r;
}

/** The length of a bed's outline, in inches. */
export function bedPerimeter(bed: Bed): number {
  const { widthIn: w, heightIn: h } = bed;
  if (bed.shape === 'ellipse') {
    const a = w / 2;
    const b = h / 2;
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); // Ramanujan's approximation
  }
  if (bed.shape === 'polygon' && bed.points) return bed.points.reduce((sum, p, i) => sum + Math.hypot(bed.points![(i + 1) % bed.points!.length].x - p.x, bed.points![(i + 1) % bed.points!.length].y - p.y), 0);
  return 2 * (w + h);
}

/**
 * The area of a bed shrunk by `insetIn` on every side: what is left once a margin that wide is
 * kept clear. A rectangle and an ellipse shrink exactly (rounded corners ignored); a polygon by
 * area minus perimeter × inset, which is a little under for a sharp corner.
 */
export function insetArea(bed: Bed, insetIn: number): number {
  if (insetIn <= 0) return bedArea(bed);
  const { widthIn: w, heightIn: h } = bed;
  if (bed.shape === 'ellipse') return Math.max(0, w / 2 - insetIn) * Math.max(0, h / 2 - insetIn) * Math.PI;
  if (bed.shape === 'polygon' && bed.points) return Math.max(0, bedArea(bed) - bedPerimeter(bed) * insetIn);
  return Math.max(0, w - 2 * insetIn) * Math.max(0, h - 2 * insetIn);
}

/** The area one plant's growing room takes, in square inches (a disc of radius spacing / 2). */
export const plantArea = (spacingIn: number): number => (Math.PI * spacingIn * spacingIn) / 4;

/**
 * How many plants of a crop to aim for: its share of the free area (`areaIn2`, which the
 * crop may use), by weight, times the fill ratio, divided by the square of its spacing, rounded,
 * then clamped to [min, max]. Never below 1 before clamping: a crop that was asked for is aimed
 * at, and whether even one fits is for the search to find out.
 */
export function targetCount(areaIn2: number, fillRatio: number, weight: number, totalWeight: number, spacingIn: number, min?: number, max?: number): number {
  const raw = Math.round((areaIn2 * fillRatio * (weight / totalWeight)) / (spacingIn * spacingIn));
  let t = Math.max(1, raw);
  if (max !== undefined) t = Math.min(t, max);
  if (min !== undefined) t = Math.max(t, min);
  return Math.max(t, 1);
}
