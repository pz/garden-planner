import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';

export interface OverlapConflict {
  /** groupIds of the two conflicting entities (a patch or a solo plant), canonically a < b. */
  a: string;
  b: string;
}

/** Canonical, order-independent key for a conflict between two groupIds. */
export function conflictKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Closer than this fraction of the required gap, a spacing warning is "problem" rather than
 * "caution" severity.
 */
export const HARD_SPACING_FACTOR = 0.7;

/** Two entities sitting closer than the average of their crops' spacing, with how close. */
export interface SpacingConflict extends OverlapConflict {
  bedId: string;
  /** Distance between the closest pair of members, in inches. */
  distanceIn: number;
  /** The gap those two members' crops want between them (the average of their spacings), in inches. */
  requiredGapIn: number;
  /** Crop ids of the closest pair of members, in the order of `a` and `b`. */
  cropIds: [string, string];
}

/**
 * Pairs of entities (a patch or a solo plant, identified by groupId) that sit closer than
 * either crop's required spacing, each with its closest approach. Warnings live on the entity,
 * not the individual plant, so two members of the same patch never conflict with each other,
 * and one dismissal at the entity level (see conflictKey) resolves the warning on both sides
 * of the pair. Plants in different beds never conflict: their x/y are in different beds'
 * frames, and a bed's edge is where its plants' room to grow ends. Ordered by first discovery.
 */
export function findSpacingConflicts(plants: PlantInstance[]): SpacingConflict[] {
  const byKey = new Map<string, SpacingConflict>();
  for (let i = 0; i < plants.length; i++) {
    for (let j = i + 1; j < plants.length; j++) {
      const p = plants[i];
      const q = plants[j];
      if (p.groupId === q.groupId) continue; // members of the same patch are meant to sit close
      if (p.bedId !== q.bedId) continue;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Two entities conflict once any pair of their members is closer than the average of their required spacing.
      const requiredGap = (getCrop(p.cropId).spacingIn + getCrop(q.cropId).spacingIn) / 2;
      if (dist >= requiredGap) continue;
      const key = conflictKey(p.groupId, q.groupId);
      const [first, second] = p.groupId < q.groupId ? [p, q] : [q, p];
      const existing = byKey.get(key);
      // Keep the worst (smallest dist / gap) pair of members as the entity's representative.
      if (existing && existing.distanceIn / existing.requiredGapIn <= dist / requiredGap) continue;
      byKey.set(key, {
        a: first.groupId,
        b: second.groupId,
        bedId: p.bedId,
        distanceIn: dist,
        requiredGapIn: requiredGap,
        cropIds: [first.cropId, second.cropId],
      });
    }
  }
  return [...byKey.values()];
}

/** The overlapping pairs alone, without distances; see findSpacingConflicts. */
export function findOverlapConflicts(plants: PlantInstance[]): OverlapConflict[] {
  return findSpacingConflicts(plants).map(({ a, b }) => ({ a, b }));
}
