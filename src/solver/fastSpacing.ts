import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { conflictKey } from '../core/spacing';
import { DiscIndex } from './discIndex';
import { distance, isProblemSpacing, isSpacingConflict, requiredGap } from './rules';

/** One pair of patches in a spacing conflict, as `findSpacingConflicts` would report it. */
export interface FastSpacingConflict {
  /** groupIds, canonically a < b. */
  a: string;
  b: string;
  bedId: string;
  distanceIn: number;
  requiredGapIn: number;
  problem: boolean;
}

/**
 * The same answer as `findSpacingConflicts` (plus the problem flag the warnings add), computed
 * with a bucket grid per bed instead of comparing every pair. The solver's inner loop uses the
 * same pieces incrementally; `consistency.test.ts` checks the two agree on random layouts.
 * Order differs from core's; compare by key.
 */
export function fastSpacingConflicts(plants: PlantInstance[]): FastSpacingConflict[] {
  const byBed = new Map<string, PlantInstance[]>();
  for (const p of plants) {
    const list = byBed.get(p.bedId);
    if (list) list.push(p);
    else byBed.set(p.bedId, [p]);
  }
  const worst = new Map<string, FastSpacingConflict>();
  for (const [bedId, members] of byBed) {
    const widest = Math.max(...members.map((p) => getCrop(p.cropId).spacingIn));
    const index = new DiscIndex(widest);
    for (const p of members) index.add({ x: p.x, y: p.y, spacingIn: getCrop(p.cropId).spacingIn, group: p.groupId });
    for (const p of members) {
      const sp = getCrop(p.cropId).spacingIn;
      // The gap is an average of two spacings, so never more than the widest.
      index.forEachNear(p.x, p.y, widest, (d) => {
        if (d.group <= p.groupId) return; // each pair of patches once, and never a patch with itself
        const g = requiredGap(sp, d.spacingIn);
        const dist = distance(p, d);
        if (!isSpacingConflict(dist, g)) return;
        const key = conflictKey(p.groupId, d.group);
        const prior = worst.get(key);
        if (prior && prior.distanceIn / prior.requiredGapIn <= dist / g) return;
        worst.set(key, { a: p.groupId, b: d.group, bedId, distanceIn: dist, requiredGapIn: g, problem: isProblemSpacing(dist, g) });
      });
    }
  }
  return [...worst.values()];
}
