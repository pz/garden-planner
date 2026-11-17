import { getCrop } from '../data/crops';
import type { Point } from '../types';
import { COMPANION_NEAR_IN, avoidanceBetween } from '../core/companions';
import { SHADE_HEIGHT_MARGIN_IN, SHADE_REACH_FACTOR } from '../core/shade';
import type { Group } from './model';

// The shade and companion rules between two patches, written for the solver's inner loop. They
// use the same constants and the same arithmetic as core/shade.ts and core/companions.ts, and
// `consistency.test.ts` checks they agree with findShadeConflicts and findCompanionConflicts.

/** Whether a patch of `casterCropId` can shade a patch of `shadedCropId` at all (the crop-level half of the rule). */
export function canShade(casterCropId: string, shadedCropId: string): boolean {
  const caster = getCrop(casterCropId);
  const shaded = getCrop(shadedCropId);
  return shaded.sunNeed === 'full' && caster.heightIn - shaded.heightIn >= SHADE_HEIGHT_MARGIN_IN;
}

const gap = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, a0 - b1, b0 - a1);

/**
 * Whether `caster` shades `shaded`: some plant of the shaded patch lies ahead of some plant of the
 * caster along the shadow direction `dir` (garden coordinates), within the caster's reach and
 * inside the band its canopy is wide. Both groups' garden points are used, so it works across beds.
 */
export function shades(caster: Group, shaded: Group, dir: Point): boolean {
  if (caster.id === shaded.id || !canShade(caster.cropId, shaded.cropId)) return false;
  const height = getCrop(caster.cropId).heightIn;
  const reach = height * SHADE_REACH_FACTOR;
  const half = caster.spacingIn / 2;
  // Boxes further apart than the reach plus the half-band cannot hold a shaded pair.
  const a = caster.gardenBox;
  const b = shaded.gardenBox;
  const far = reach + half;
  if (gap(a.x0, a.x1, b.x0, b.x1) > far || gap(a.y0, a.y1, b.y0, b.y1) > far) return false;
  for (const p of caster.garden) {
    for (const q of shaded.garden) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const along = dx * dir.x + dy * dir.y;
      const across = Math.abs(dx * dir.y - dy * dir.x);
      if (along <= 0 || along > reach) continue;
      if (across > half) continue;
      return true;
    }
  }
  return false;
}

/**
 * The weight of a companion conflict between two patches in the same bed, or 0: 1 for advice backed
 * by an extension source, 0.5 for anecdotal advice, when the crops are usually kept apart and the
 * closest plants are less than COMPANION_NEAR_IN apart.
 */
export function companionWeight(a: Group, b: Group): number {
  if (a.bedId !== b.bedId || a.id === b.id) return 0;
  const avoid = avoidanceBetween(a.cropId, b.cropId);
  if (!avoid) return 0;
  const near = COMPANION_NEAR_IN;
  const ba = a.box;
  const bb = b.box;
  if (gap(ba.x0, ba.x1, bb.x0, bb.x1) >= near || gap(ba.y0, ba.y1, bb.y0, bb.y1) >= near) return 0;
  for (const p of a.points) {
    for (const q of b.points) {
      if (Math.hypot(p.x - q.x, p.y - q.y) < near) return avoid.evidence === 'anecdotal' ? 0.5 : 1;
    }
  }
  return 0;
}
