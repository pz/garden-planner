import type { ScoreBreakdown } from './proposal';

// The objective's named constants. All of them are first guesses, tuned with `--sweep` on the
// fixtures (see README). A plant's worth is about `weight / target`, typically 0.02 to 0.15, so
// the per-plant penalties are small fractions of that.

/** Cost of a plant short of its `min` or over its `max`, per plant. */
export const BIG = 1000;
/** Multiplies the spacing penalty sum (each pair costs 0 at the full gap, 1 at the hard floor). */
export const SPACING_WEIGHT = 0.05;
/** Per plant of the shaded patch, for each shade conflict. */
export const SHADE_WEIGHT = 0.08;
/** Per companion conflict between two patches; halved for anecdotal evidence. */
export const COMPANION_WEIGHT = 0.3;
/** Per extra block of the same crop in one bed. */
export const CLUSTER_WEIGHT = 0.1;
/** Per plant, times the share of its growing room outside the bed. */
export const SPILL_WEIGHT = 0.04;
/** Times the share of existing plants removed or moved, in adjust mode. */
export const CHANGE_WEIGHT = 2;
/** Per full-sun plant in a part-shade garden. */
export const SUN_WEIGHT = 0.04;

/**
 * The value of having `n` of a crop when `t` were wanted: 0 at none, 1 at the target, concave
 * below it (so every crop gets some room before any crop gets more) and nearly flat above it.
 */
export function demandCurve(n: number, t: number): number {
  const r = n / t;
  return r <= 1 ? 1 - (1 - r) * (1 - r) : 1 + 0.05 * (r - 1);
}

/** Plants beyond the limits, times BIG. */
export function minMaxPenalty(n: number, min: number | undefined, max: number | undefined): number {
  return BIG * (Math.max(0, (min ?? 0) - n) + Math.max(0, n - (max ?? Infinity)));
}

export const emptyBreakdown = (): ScoreBreakdown => ({ demand: 0, minMax: 0, spacing: 0, shade: 0, companion: 0, clustering: 0, spill: 0, change: 0, sun: 0, total: 0 });
