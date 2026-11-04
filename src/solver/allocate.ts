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
